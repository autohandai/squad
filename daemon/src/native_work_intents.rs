//! Persist process identity before the stdin launch handshake. A daemon crash
//! must not erase evidence of a detached native process that may still write.
use crate::{
    ownership::read_private_json, ownership_activity::OwnershipActivity, state::StatePaths,
};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Arc};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    version: u8,
    daemon_pid: u32,
    daemon_instance: String,
    group: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    job_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    boot_uptime_ms: Option<u64>,
}

fn directory(paths: &StatePaths) -> Result<PathBuf> {
    let path = paths.root.join("native-work-intents");
    fs::create_dir_all(&path)?;
    let info = fs::symlink_metadata(&path)?;
    if !info.is_dir() || info.file_type().is_symlink() {
        bail!("Unsafe native work journal");
    }
    Ok(path)
}

pub(crate) fn unresolved(paths: &StatePaths) -> Result<bool> {
    let directory = directory(paths)?;
    let mut unresolved = false;
    for entry in fs::read_dir(&directory)? {
        let path = entry?.path();
        // A .pending file is an interrupted atomic replacement, never an
        // alternate authority for starting a workload.
        if path.extension().is_some_and(|value| {
            value == "pending" || value == "drained" || value == "drain-pending"
        }) {
            continue;
        }
        let intent: Record = read_private_json(&path, 4096)?;
        if intent.version != 1 || crate::cli::process_is_running(intent.daemon_pid) {
            unresolved = true;
            continue;
        }
        let gone = match intent.group {
            #[cfg(windows)]
            _ if intent.job_name.is_some() => {
                let name = intent.job_name.as_deref().unwrap();
                crate::owned_windows::drain_receipt_matches(&path.with_extension("drained"), name)?
                    || crate::owned_windows::job_is_empty(name)? == Some(true)
                    || intent
                        .boot_uptime_ms
                        .is_some_and(|saved| crate::owned_windows::uptime_ms() < saved)
            }
            None => true, // No launch handshake can have been sent.
            #[cfg(unix)]
            Some(pid) if pid > 1 => {
                (unsafe { libc::kill(-(pid as i32), 0) }) == -1
                    && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
            }
            _ => false,
        };
        if gone {
            fs::remove_file(path)?;
        } else {
            unresolved = true;
        }
    }
    sync_directory(&directory)?;
    Ok(unresolved)
}

pub(crate) struct NativeWorkIntent {
    path: PathBuf,
    record: Record,
    gate: Arc<OwnershipActivity>,
    spawned: bool,
    cleared: bool,
}
impl NativeWorkIntent {
    pub(crate) fn create(
        paths: &StatePaths,
        id: &str,
        instance: &str,
        gate: Arc<OwnershipActivity>,
    ) -> Result<Self> {
        let directory = directory(paths)?;
        let guard = Self {
            path: directory.join(format!("{id}.json")),
            record: Record {
                version: 1,
                daemon_pid: std::process::id(),
                daemon_instance: instance.into(),
                group: None,
                job_name: {
                    #[cfg(windows)]
                    {
                        use sha2::{Digest, Sha256};
                        let digest: String = Sha256::digest(format!("{instance}:{id}").as_bytes())
                            .iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect();
                        Some(format!("Global\\AutohandSquad-{digest}"))
                    }
                    #[cfg(not(windows))]
                    {
                        None
                    }
                },
                boot_uptime_ms: {
                    #[cfg(windows)]
                    {
                        Some(crate::owned_windows::uptime_ms())
                    }
                    #[cfg(not(windows))]
                    {
                        None
                    }
                },
            },
            gate,
            spawned: false,
            cleared: false,
        };
        guard.save(true)?;
        Ok(guard)
    }
    fn save(&self, initial: bool) -> Result<()> {
        let temporary = self.path.with_extension("pending");
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let path = if initial { &self.path } else { &temporary };
        let mut file = options.open(path)?;
        file.write_all(serde_json::to_string(&self.record)?.as_bytes())?;
        file.sync_all()?;
        if !initial {
            #[cfg(windows)]
            crate::owned_windows::replace_file(&temporary, &self.path)?;
            #[cfg(not(windows))]
            fs::rename(temporary, &self.path)?;
        }
        sync_directory(self.path.parent().expect("intent directory"))?;
        Ok(())
    }
    pub(crate) fn spawned(&mut self, group: Option<u32>) -> Result<()> {
        self.spawned = true;
        self.record.group = group;
        self.save(false)
    }
    #[cfg(windows)]
    pub(crate) fn job_name(&self) -> &str {
        self.record
            .job_name
            .as_deref()
            .expect("Windows work intent has a job name")
    }
    #[cfg(windows)]
    pub(crate) fn receipt_path(&self) -> PathBuf {
        self.path.with_extension("drained")
    }
    pub(crate) fn clear(&mut self) -> Result<()> {
        fs::remove_file(&self.path)?;
        match fs::remove_file(self.path.with_extension("drained")) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        sync_directory(self.path.parent().expect("intent directory"))?;
        self.cleared = true;
        Ok(())
    }
}

fn sync_directory(path: &std::path::Path) -> Result<()> {
    #[cfg(not(windows))]
    fs::File::open(path)?.sync_all()?;
    #[cfg(windows)]
    let _ = path; // Flush the file and write-through replacement; Windows has no portable directory fsync.
    Ok(())
}
impl Drop for NativeWorkIntent {
    fn drop(&mut self) {
        if self.cleared {
            return;
        }
        if self.spawned || self.clear().is_err() {
            self.gate.uncertain_cleanup();
        }
    }
}
