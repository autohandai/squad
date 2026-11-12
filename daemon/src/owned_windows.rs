//! A launch gate is assigned before it may create any workload. The job handle
//! is never inherited; losing the supervisor closes it and kills every child.
use anyhow::{bail, Context, Result};
use std::{
    ffi::OsStr,
    io::{BufRead, Read, Write},
    os::windows::ffi::OsStrExt,
    path::Path,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_FILE_NOT_FOUND,
        ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
    },
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG},
    Storage::FileSystem::{
        MoveFileExW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, MOVEFILE_REPLACE_EXISTING,
        MOVEFILE_WRITE_THROUGH, PIPE_ACCESS_DUPLEX,
    },
    System::{
        JobObjects::*,
        Pipes::*,
        SystemInformation::GetTickCount64,
        SystemServices::JOB_OBJECT_QUERY,
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

fn wide(value: &OsStr) -> Result<Vec<u16>> {
    let mut bytes: Vec<u16> = value.encode_wide().collect();
    if bytes.contains(&0) {
        bail!("NUL in native argument");
    }
    bytes.push(0);
    Ok(bytes)
}
fn job_name(name: &str) -> Result<Vec<u16>> {
    let suffix = name
        .strip_prefix("Global\\AutohandSquad-")
        .context("Invalid owned job name")?;
    if suffix.len() != 64 || !suffix.bytes().all(|v| v.is_ascii_hexdigit()) {
        bail!("Invalid owned job name");
    }
    wide(OsStr::new(name))
}

// Store the owned handle as an integer so an async run can move between Tokio
// threads. All Win32 operations accept an explicitly owned handle; no thread
// affinity or global job state is involved.
pub struct OwnedJob(usize);
impl Drop for OwnedJob {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0 as _);
        }
    }
}
impl OwnedJob {
    pub fn create(name: &str) -> Result<Self> {
        let name = job_name(name)?;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), name.as_ptr()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        let job = Self(handle as usize);
        if existed {
            bail!("Owned job name already exists");
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(job)
    }
    pub fn attach_handle(&self, handle: usize) -> Result<()> {
        if unsafe { AssignProcessToJobObject(self.0 as _, handle as _) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
    fn active(&self) -> Result<u32> {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe {
            QueryInformationJobObject(
                self.0 as _,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as _,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(info.ActiveProcesses)
    }
    pub fn terminate_and_wait(&self) -> Result<()> {
        if unsafe { TerminateJobObject(self.0 as _, 125) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.active()? != 0 {
            if Instant::now() >= deadline {
                bail!("The owned Windows job has not drained");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
}

pub fn job_is_empty(name: &str) -> Result<Option<bool>> {
    let name = job_name(name)?;
    let handle = unsafe { OpenJobObjectW(JOB_OBJECT_QUERY, 0, name.as_ptr()) };
    if handle.is_null() {
        if unsafe { GetLastError() } == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        return Err(std::io::Error::last_os_error().into());
    }
    let job = OwnedJob(handle as usize);
    Ok(Some(job.active()? == 0))
}

pub fn uptime_ms() -> u64 {
    unsafe { GetTickCount64() }
}
pub fn job_pipe(name: &str) -> Result<String> {
    job_name(name)?;
    Ok(format!("\\\\.\\pipe\\AutohandSquad-{}", &name[21..]))
}

pub struct JobWatchdog {
    child: tokio::process::Child,
    output: tokio::io::BufReader<tokio::process::ChildStdout>,
}
impl JobWatchdog {
    pub async fn start(helper: &Path, name: &str, receipt: &Path) -> Result<Self> {
        let mut command = tokio::process::Command::new(helper);
        command.args([
            OsStr::new("--ownership-job"),
            OsStr::new(name),
            receipt.as_os_str(),
        ]);
        command
            .env_remove("AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN")
            .env_remove("AUTOHAND_SQUAD_WORKER_TOKEN")
            .env_remove("AUTOHAND_SQUAD_WORKER_CONTEXT");
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        // Dropping/losing the daemon closes stdin. Keep the external watchdog
        // alive long enough to terminate the job and publish its drain proof.
        let mut child = command.spawn()?;
        let output =
            tokio::io::BufReader::new(child.stdout.take().context("Missing job response pipe")?);
        let mut watchdog = Self { child, output };
        if watchdog.event().await?["ready"] != true {
            bail!("The native job supervisor did not start");
        }
        Ok(watchdog)
    }
    async fn event(&mut self) -> Result<serde_json::Value> {
        use tokio::io::AsyncBufReadExt;
        let mut line = String::new();
        let count = tokio::time::timeout(Duration::from_secs(35), self.output.read_line(&mut line))
            .await??;
        if count == 0 || count > 8192 {
            bail!("The native job supervisor stopped or returned an invalid reply");
        }
        let value: serde_json::Value = serde_json::from_str(&line)?;
        if value["success"] != true {
            bail!("Native job supervision failed");
        }
        Ok(value)
    }
    pub async fn attached(&mut self, pid: u32) -> Result<()> {
        if self.event().await?["attached"] != pid {
            bail!("The native launch did not match its job supervisor");
        }
        Ok(())
    }
    pub async fn terminate(&mut self) -> Result<()> {
        use tokio::io::AsyncWriteExt;
        self.child
            .stdin
            .as_mut()
            .context("Missing job control pipe")?
            .write_all(b"{\"action\":\"terminate\"}\n")
            .await?;
        if self.event().await?["drained"] != true {
            bail!("Native job cleanup was not confirmed");
        }
        tokio::time::timeout(Duration::from_secs(10), self.child.wait()).await??;
        Ok(())
    }
}
pub fn drain_receipt_matches(path: &Path, name: &str) -> Result<bool> {
    let info = match std::fs::symlink_metadata(path) {
        Ok(info) => info,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !info.is_file() || info.file_type().is_symlink() || info.len() > 4096 {
        bail!("Invalid owned drain receipt");
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(4097)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        bail!("Invalid owned drain receipt");
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)?;
    Ok(value["version"] == 1 && value["jobName"] == name && value["drained"] == true)
}
fn record_drain(path: &Path, name: &str) -> Result<()> {
    if !path.is_absolute() {
        bail!("The owned drain receipt must be absolute");
    }
    let temporary = path.with_extension("drain-pending");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(
        serde_json::to_string(&serde_json::json!({"version":1,"jobName":name,"drained":true}))?
            .as_bytes(),
    )?;
    file.sync_all()?;
    drop(file);
    replace_file(&temporary, path)
}

fn reply(value: serde_json::Value) -> Result<()> {
    let mut out = std::io::stdout().lock();
    writeln!(out, "{value}")?;
    out.flush()?;
    Ok(())
}
pub fn controller(name: &str, receipt: &Path) -> Result<()> {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };
    let job = Arc::new(Mutex::new((OwnedJob::create(name)?, false)));
    let pipe_name = wide(OsStr::new(&job_pipe(name)?))?;
    let pipe = unsafe {
        CreateNamedPipeW(
            pipe_name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            128,
            128,
            0,
            std::ptr::null(),
        )
    };
    if pipe == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().into());
    }
    let pipe = pipe as usize;
    let attached = Arc::new(AtomicBool::new(false));
    let proof = attached.clone();
    let binding = job.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<()> {
            let pipe = pipe as windows_sys::Win32::Foundation::HANDLE;
            if unsafe { ConnectNamedPipe(pipe, std::ptr::null_mut()) } == 0
                && unsafe { GetLastError() } != ERROR_PIPE_CONNECTED
            {
                return Err(std::io::Error::last_os_error().into());
            }
            let mut pid = 0;
            if unsafe { GetNamedPipeClientProcessId(pipe, &mut pid) } == 0 || pid < 2 {
                bail!("Cannot identify the waiting worker");
            }
            let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
            if process.is_null() {
                return Err(std::io::Error::last_os_error().into());
            }
            // Hold this HANDLE before asking the pipe client to prove it is
            // still alive. A recycled PID cannot answer on the old connection.
            let process = OwnedJob(process as usize); // generic owned HANDLE
            let mut challenge = [0u8; 16];
            if unsafe {
                BCryptGenRandom(
                    std::ptr::null_mut(),
                    challenge.as_mut_ptr(),
                    16,
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG,
                )
            } < 0
            {
                bail!("The worker proof could not be generated");
            }
            let mut written = 0;
            let mut count = 0;
            let mut echo = [0u8; 16];
            if unsafe {
                WriteFile(
                    pipe,
                    challenge.as_ptr(),
                    16,
                    &mut written,
                    std::ptr::null_mut(),
                )
            } == 0
                || written != 16
            {
                bail!("Worker proof could not be sent");
            }
            while count < 16 {
                let mut read = 0;
                if unsafe {
                    ReadFile(
                        pipe,
                        echo[count..].as_mut_ptr(),
                        (16 - count) as u32,
                        &mut read,
                        std::ptr::null_mut(),
                    )
                } == 0
                    || read == 0
                {
                    bail!("Worker proof disconnected");
                }
                count += read as usize;
            }
            if echo != challenge {
                bail!("Worker proof did not match");
            }
            let held = binding
                .lock()
                .map_err(|_| anyhow::anyhow!("Job control unavailable"))?;
            if held.1 {
                bail!("Job is already closing");
            }
            held.0.attach_handle(process.0)?;
            proof.store(true, Ordering::Release);
            drop(held);
            unsafe {
                DisconnectNamedPipe(pipe);
                CloseHandle(pipe);
            }
            reply(serde_json::json!({"success":true,"attached":pid}))
        })();
        if let Err(error) = result {
            eprintln!("Worker job binding failed: {error:#}");
            std::process::exit(1);
        }
    });
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        if !attached.load(Ordering::Acquire) {
            std::process::exit(125);
        }
    });
    reply(serde_json::json!({"success":true,"ready":true}))?;
    let mut input = std::io::stdin().lock();
    loop {
        let mut bytes = Vec::new();
        let read = std::io::Read::take(&mut input, 4097).read_until(b'\n', &mut bytes)?;
        if read == 0 {
            let mut held = job
                .lock()
                .map_err(|_| anyhow::anyhow!("Job control unavailable"))?;
            held.1 = true;
            held.0.terminate_and_wait()?;
            drop(held);
            record_drain(receipt, name)?;
            std::process::exit(0);
        }
        if bytes.len() > 4096 || bytes.last() != Some(&b'\n') {
            bail!("Invalid job control request");
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes)?;
        match value["action"].as_str() {
            Some("terminate") => {
                let mut held = job
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Job control unavailable"))?;
                held.1 = true;
                held.0.terminate_and_wait()?;
                drop(held);
                record_drain(receipt, name)?;
                reply(serde_json::json!({"success":true,"drained":true}))?;
                std::process::exit(0);
            }
            _ => bail!("Unsupported job control request"),
        }
    }
}

pub fn replace_file(from: &Path, to: &Path) -> Result<()> {
    if from.parent() != to.parent() {
        bail!("Owned metadata replacements must stay in one directory");
    }
    let from = wide(from.as_os_str())?;
    let to = wide(to.as_os_str())?;
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

/// Called before ordinary Clap parsing, listeners, configuration or telemetry.
pub fn helper_entry() -> Option<Result<()>> {
    let args: Vec<_> = std::env::args_os().collect();
    match args.get(1)?.to_str()? {
        "--ownership-job" => Some((|| {
            if args.len() != 4 {
                bail!("Expected job name and drain receipt");
            }
            controller(
                args[2].to_str().context("Invalid job name")?,
                Path::new(&args[3]),
            )
        })()),
        "--ownership-job-status" => Some((|| {
            if args.len() != 3 {
                bail!("Expected job name");
            }
            let empty = job_is_empty(args[2].to_str().context("Invalid job name")?)?;
            reply(
                serde_json::json!({"empty":empty==Some(true),"missing":empty.is_none(),"uptimeMs":uptime_ms()}),
            )
        })()),
        "--ownership-uptime" => Some(reply(serde_json::json!({"uptimeMs":uptime_ms()}))),
        "--ownership-replace" => Some((|| {
            if args.len() != 4 {
                bail!("Expected metadata paths");
            }
            replace_file(Path::new(&args[2]), Path::new(&args[3]))
        })()),
        "--ownership-launch" => Some((|| {
            if args.len() < 3 {
                bail!("Expected workload");
            }
            let pipe = std::env::var("AUTOHAND_SQUAD_WIN_JOB_PIPE")
                .context("Missing native job binding")?;
            std::env::remove_var("AUTOHAND_SQUAD_WIN_JOB_PIPE");
            let mut proof = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(pipe)?;
            let mut challenge = [0u8; 16];
            proof.read_exact(&mut challenge)?;
            proof.write_all(&challenge)?;
            drop(proof);
            let mut start = String::new();
            std::io::stdin().read_line(&mut start)?;
            if start != "start\n" {
                bail!("Launch was not admitted");
            }
            let code = std::process::Command::new(&args[2])
                .args(&args[3..])
                .stdin(std::process::Stdio::null())
                .status()?
                .code()
                .unwrap_or(125);
            std::process::exit(code);
        })()),
        _ => None,
    }
}
