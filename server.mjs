import { createServer } from "node:http";
import { hostname } from "node:os";
import { OtelLogger, SEVERITY, parseLogEnvelope, resourceFromEnv, traceIdFor, spanIdFor } from "./server/otel-logs.mjs";
import { SdkSessionPool } from "./server/sdk-sessions.mjs";
import { replyFailure } from "./server/sdk-events.mjs";
import { HarnessLoginManager } from "./server/harness/login.mjs";
import { openSignInUrl } from "./server/harness/open-login.mjs";
import { spawn, spawnSync } from "node:child_process";
import { profileWorkspace } from "./server/workspace-profile.mjs";
import { updateDaemonAdmission } from "./server/mac-update.mjs";
import { createUpdateFlow } from "./server/update-flow.mjs";
import { desktopUpdateStatus, openDesktopTarget, RELEASES_URL } from "./server/desktop-updates.mjs";
import { createUsageLedgerCache, usageLedger } from "./server/usage/ledger.mjs";
import { autoCheckUpdatesEnabled, readSystemSettings } from "./server/system/settings.mjs";
import { readAppInfo } from "./server/app-info.mjs";
import { bundledComputerClient, createComputerUse } from "./server/computer-use.mjs";
import { createConnectorStore } from "./server/connectors/store.mjs";
import { autohandServersFor, claudeMcpConfig, codexConfigArgs, connectorInstructions, connectorsAllowed, mergeAutohandMcp } from "./server/connectors/inject.mjs";
import { VAULT_MCP_SERVER_NAME, createVaultService } from "./server/vault/service.mjs";
import { AUTOHAND_TEAM_WAIT_SECONDS, TEAM_MCP_SERVER_NAME, createTeamService, teamMessagePrompt } from "./server/team/service.mjs";
import { createTeamChannels } from "./server/team/channels.mjs";
import { createCliBootstrap, createCliProbe } from "./server/runtime/cli-bootstrap.mjs";
import { STORE_FILE as WORK_STORE_FILE, workStoreFor } from "./server/work/store.mjs";
import { vaultToolsAllowed } from "./src/lib/permission-policy.js";
import { createProductTelemetry, readProductTelemetryConfig } from "./server/product-telemetry.mjs";
import { MemberAvailability } from "./server/members/availability.mjs";
import { GoalManager } from "./server/goal-manager.mjs";
import { contextUsageFromUsage } from "./server/queues/context-gauge.mjs";
import { privateLaunch } from "./server/queues/store.mjs";
import { ProjectObserver } from "./server/project-observer.mjs";
import { createProjectObserverReview } from "./server/project-observer-review.mjs";
import { cleanWorkResult, withWorkProgress } from "./server/work-progress.mjs";
import { bridgeEvents, emitBridgeEvent } from "./server/events.mjs";
import { handlePluginRoute, loadRoutePlugins } from "./server/routes/index.mjs";
import { proxyJson, proxyStream, remoteRequestAuth, resolveRemote } from "./server/routes/remote.route.mjs";
import { isRemoteTransport } from "./server/remote/auth.mjs";
import { StringDecoder } from "node:string_decoder";
import { constants as fsConstants, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { arch, homedir, platform as osPlatform, release as osRelease, tmpdir } from "node:os";
import { clientClosedReason, stopMessage } from "./server/harness/stop-reason.mjs";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { listLocalSkills, localSkillRoots, readSkillFolder } from "./server/skills/local.mjs";
import { startTracking } from "./server/workspace-git.mjs";
import { channelError, createChannelsStore } from "./server/channels-store.mjs";
import { createAgentChannelActions } from "./server/agent-channel-actions.mjs";
import { createResponderPicker } from "./server/responders/pick.mjs";
import { createRunHistory, runHistoryPath } from "./server/runs/history.mjs";
import { clearHarnessSessions } from "./server/chats/sessions.mjs";
import { ChatStore } from "./server/chats/store.mjs";
import { buildRecall, collectRecallSources } from "./server/chats/recall.mjs";
import { workPlanFor } from "./server/work/plan.mjs";
import { describeSchedule, isValidTimeZone, normalizeSchedule, validateSchedule } from "./server/routines/schedule.mjs";
import { scheduleActionInstruction, taskActionInstruction } from "./src/lib/routines.js";
import { automationNudgeLine, detectRecurringWork, repeatedWorkSignal, replyProposedSchedule } from "./src/lib/work-plans.js";
import { MEMBER_PROFILE_FIELDS, memberProfileRevision, mergeMemberProfile, memberShapingInstruction, needsShapingInstruction } from "./src/lib/member-shaping.js";
import { normalizeResponder, responderStatus } from "./src/lib/channel-responders.js";
import { normalizeChannelReplyMode } from "./src/lib/channel-replies.js";
import { readPersistentJson, writePersistentJson } from "./server/persistent-json.mjs";
import { memberProfileDefaults } from "./src/lib/member-profiles.js";
import { CHAT_TURN_CEILING_MS } from "./src/lib/chat-timing.js";
import {
  DEFAULT_HARNESS_ID,
  HarnessNotReadyError,
  assertHarnessReady,
  detectHarness,
  getAdapter,
  harnessAssignmentFromAgent,
  isExternalHarness,
  isAcpHarness,
  normalizeAccess,
  normalizeEffort,
  listHarnesses,
  normalizeHarnessAssignment,
  publicReadiness,
  readResumeId,
  redactHome,
  runExternalHarness,
  writeResumeId,
} from "./server/harness/index.mjs";
import { COLD_START_RETRY_DELAY_MS, classifyColdStart, engineHome, freeDiskBytes, looksLikeStaleSession } from "./server/harness/cold-start.mjs";
import { formatDuration } from "./src/lib/duration.js";

// Keep native human approval out of every agent/helper inherited environment.
const initialNativeGrantKey = String(process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN || "");
delete process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;

// Emit run.finished exactly once per run: a CLI child can fire "error" and
// then "close", and the SDK/harness paths have a completion and a catch
// branch; each of them calls this after setting run.status.
function emitRunFinished(run) {
  if (!run || run.finishedEventAt) return null;
  run.finishedEventAt = run.finishedAt || new Date().toISOString();
  runHistory.persist();
  return emitBridgeEvent("run.finished", {
    runId: run.id,
    memberId: run.agentId || "",
    status: run.status,
    title: run.title || "",
    workspace: run.workspace || "",
  });
}

// Remote members (docs/integration/remote.md): a member registered under
// <squadStateDir>/remotes.json runs on another machine's bridge. Chat, stream
// and run requests for it are forwarded with that bridge's bearer token and
// the reply comes back unchanged with `transport: "remote"`. The remote
// bridge emits its own run.finished for the work it runs; this bridge only
// records chat.finished for what it forwarded and never touches `runs` for
// a proxied run.
//
// The remote's run id is what the app holds afterwards, so GET /api/runs/:id
// and POST /api/runs/:id/stop need to know which member (and so which
// bridge) a run id belongs to: proxied run ids are remembered here, in
// memory, bounded to the most recent few hundred.
const remoteRunMembers = new Map();
const REMOTE_RUN_MEMORY = 500;
function rememberRemoteRun(runId, memberId) {
  const id = String(runId || "").trim();
  if (!id) return;
  remoteRunMembers.delete(id);
  remoteRunMembers.set(id, String(memberId || "").trim());
  while (remoteRunMembers.size > REMOTE_RUN_MEMORY) remoteRunMembers.delete(remoteRunMembers.keys().next().value);
}

// `payload.workspace` is a path on this machine; the remote bridge uses its
// default workspace unless the remote record pins one there.
function remotePayload(payload, remote) {
  const { workspace: _local, ...rest } = payload || {};
  return remote?.workspace ? { ...rest, workspace: remote.workspace } : rest;
}

function remoteErrorEnvelope(res, error) {
  if (res.headersSent) return;
  json(res, error?.status || 502, {
    success: false,
    error: error?.message || String(error),
    remote: error?.remote || null,
    retryable: error?.retryable !== false,
  });
}

function remoteChatFinished(payload, remote, outcome) {
  emitBridgeEvent("chat.finished", {
    memberId: String(payload.agentId || ""),
    status: outcome?.status || "completed",
    channelId: String(payload.channelId || payload.channel?.id || ""),
    threadId: String(payload.threadId || payload.channel?.threadId || ""),
    preview: String(outcome?.preview || "").slice(0, 140),
    transport: "remote",
    remote: { label: remote.label, url: remote.url },
  });
}

function logRemoteProxy(remote, route, memberId, extra = {}) {
  logEvent(SEVERITY.INFO, `${route} for ${memberId} proxied to ${remote.label}`, {
    "event.name": "remote.proxied",
    "url.path": route,
    "autohand.member": memberId,
    "autohand.remote.label": remote.label,
    "autohand.remote.url": remote.url,
    ...extra,
  });
}

// Watch the SSE bytes piped back from a remote bridge for the final `done`
// or `error` frame so chat.finished carries the same status and preview a
// local stream would.
function tapStreamOutcome(res) {
  const write = res.write.bind(res);
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let outcome = null;
  res.write = (chunk, ...rest) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    if (buffer.length > 256 * 1024) buffer = buffer.slice(-64 * 1024);
    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      if (event !== "done" && event !== "error") continue;
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      let parsed = {};
      try {
        parsed = data ? JSON.parse(data) : {};
      } catch {
        parsed = {};
      }
      outcome =
        event === "done"
          ? { status: "completed", preview: String(parsed?.reply || "").slice(0, 140) }
          : { status: "failed", preview: String(parsed?.error || "").slice(0, 140) };
    }
    return write(chunk, ...rest);
  };
  return () => outcome || { status: "completed", preview: "" };
}

async function proxyChatOnce(remote, payload, res) {
  const memberId = String(payload.agentId || "");
  try {
    const reply = await proxyJson(remote, "/api/chat", remotePayload(payload, remote));
    logRemoteProxy(remote, "/api/chat", memberId);
    remoteChatFinished(payload, remote, { status: "completed", preview: String(reply?.reply || reply?.output || "") });
    json(res, 200, { success: true, data: reply });
  } catch (error) {
    logRemoteProxy(remote, "/api/chat", memberId, { "error.type": error?.name || "Error", "error.message": error?.message || "" });
    remoteChatFinished(payload, remote, { status: "failed", preview: error?.message || "" });
    remoteErrorEnvelope(res, error);
  }
}

async function proxyChatStream(remote, payload, res) {
  const memberId = String(payload.agentId || "");
  const outcomeOf = tapStreamOutcome(res);
  try {
    await proxyStream(remote, "/api/chat/stream", remotePayload(payload, remote), res);
  } catch (error) {
    // Only before headers were sent: the JSON envelope still reaches the client.
    logRemoteProxy(remote, "/api/chat/stream", memberId, { "error.type": error?.name || "Error", "error.message": error?.message || "" });
    remoteChatFinished(payload, remote, { status: "failed", preview: error?.message || "" });
    remoteErrorEnvelope(res, error);
    return;
  }
  const outcome = outcomeOf();
  logRemoteProxy(remote, "/api/chat/stream", memberId, { "autohand.chat.status": outcome.status });
  remoteChatFinished(payload, remote, outcome);
}

async function proxyRunStart(remote, payload, res) {
  const memberId = String(payload.agentId || "");
  try {
    const summary = await proxyJson(remote, "/api/runs", remotePayload(payload, remote));
    rememberRemoteRun(summary?.id, memberId);
    logRemoteProxy(remote, "/api/runs", memberId, { "autohand.run.id": String(summary?.id || "") });
    json(res, 201, { success: true, data: summary });
  } catch (error) {
    logRemoteProxy(remote, "/api/runs", memberId, { "error.type": error?.name || "Error", "error.message": error?.message || "" });
    remoteErrorEnvelope(res, error);
  }
}

// GET /api/runs/:id and POST /api/runs/:id/stop for a run this bridge
// forwarded: the same request goes to the bridge that runs it.
async function proxyRemoteRunRoute(req, res, url, runId) {
  const memberId = remoteRunMembers.get(String(runId || ""));
  if (!memberId) return false;
  const remote = await resolveRemote(routeContext(), memberId, { req });
  if (!remote) return false;
  try {
    const data = req.method === "POST" ? await proxyJson(remote, url.pathname, {}) : await proxyJson(remote, url.pathname);
    logRemoteProxy(remote, url.pathname, memberId, { "autohand.run.id": String(runId) });
    json(res, 200, { success: true, data });
  } catch (error) {
    remoteErrorEnvelope(res, error);
  }
  return true;
}

// Serving side: a request forwarded by another bridge arrives without a
// workspace (the caller's path means nothing here) unless the remote record
// over there pins one; this bridge's default workspace stands in.
function withRemoteDefaultWorkspace(req, payload) {
  if (!isRemoteTransport(req) || String(payload?.workspace || "").trim()) return payload;
  const fallback = getDefaultWorkspace();
  return fallback ? { ...payload, workspace: fallback } : payload;
}

// Paths another machine may reach with a bearer token this bridge minted.
const REMOTE_SERVED_PATHS = [/^\/api\/chat$/, /^\/api\/chat\/stream$/, /^\/api\/runs$/, /^\/api\/runs\/[^/]+$/, /^\/api\/runs\/[^/]+\/stop$/, /^\/api\/runtime$/, /^\/api\/members\/presence$/, /^\/api\/members\/[^/]+\/channel-access$/];
function remoteServedPath(pathname) {
  return REMOTE_SERVED_PATHS.some((pattern) => pattern.test(pathname));
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (item.startsWith("--")) {
    const next = process.argv[index + 1];
    args.set(item.slice(2), next && !next.startsWith("--") ? next : true);
  }
}

const isDev = args.get("dev") === true;
const host = String(args.get("host") || "127.0.0.1");
const port = Number(args.get("port") || 19821);
const rootDir = process.cwd();
const isPackagedRuntime = Boolean(process.env.AUTOHAND_SQUAD_APP_STATE_DIR);
const packageMetadata = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const productTelemetry = createProductTelemetry({ config: readProductTelemetryConfig(rootDir), account: readRuntimeAccount, version: packageMetadata.version });
const otel = new OtelLogger({
  resource: resourceFromEnv({
    serviceName: "autohand-squad-web",
    serviceVersion: packageMetadata.version || "",
    instanceId: `${hostname()}-${process.pid}`,
    extra: { "host.name": hostname(), "deployment.environment": process.argv.includes("--dev") ? "development" : "production" },
  }),
  scope: { name: "autohand.squad.web", version: packageMetadata.version || "" },
});

// Warm SDK sessions: one started CLI per member + launch options, reused
// across chat messages (see server/sdk-sessions.mjs).
let sdkSessions = null;
async function sdkSessionPool() {
  if (!sdkSessions) {
    const { AutohandSDK } = await loadAgentSdk();
    if (!AutohandSDK) throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
    sdkSessions = new SdkSessionPool({
      createSdk: (options) => new AutohandSDK(options),
      maxSessions: Number(process.env.AUTOHAND_SQUAD_MAX_SESSIONS) > 0 ? Number(process.env.AUTOHAND_SQUAD_MAX_SESSIONS) : 8,
      idleTtlMs: Number(process.env.AUTOHAND_SQUAD_SESSION_IDLE_MS) > 0 ? Number(process.env.AUTOHAND_SQUAD_SESSION_IDLE_MS) : 15 * 60_000,
      onEvent: (name, session, reason) =>
        logEvent(SEVERITY.INFO, `sdk ${name.replace("session_", "session ")}${reason ? ` (${reason})` : ""}`, {
          "event.name": `sdk.${name}`,
          "autohand.member.id": session.agentId,
          "autohand.workspace": session.workspace,
          "autohand.session.prompts": session.prompts,
        }),
    });
  }
  return sdkSessions;
}

const harnessLogins = new HarnessLoginManager({ openUrl: (target) => openUrlInBrowser(target) });

function openUrlInBrowser(target) {
  const url = String(target || "");
  if (!/^https?:\/\//.test(url)) return;
  const opener = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/C", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(opener[0], opener[1], { stdio: "ignore", detached: true, windowsHide: true });
  child.unref();
}

// One structured record for the bridge's own events (startup, requests that
// fail, run lifecycle, telemetry mirrors). Never throws.
function logEvent(severityNumber, body, attributes = {}, { traceId = "", spanId = "" } = {}) {
  try {
    otel.record({ file: webOtelLogPath, body, severityNumber, attributes, traceId, spanId });
  } catch {
    // Logging must never take the bridge down.
  }
}
const distDir = join(rootDir, "dist");
const homeDir = resolve(homedir());
const squadMemberIdPrefix = "asq_";
const legacySquadMemberIdPrefixes = ["wk_"];
const squadWorkspaceRoot = join(homeDir, ".autohandsquad");
const legacySquadWorkspaceRoots = [join(homeDir, ".qoderwake"), join(homeDir, ".autohand-squad")];
const appStateDir = process.env.AUTOHAND_SQUAD_APP_STATE_DIR
  ? resolve(process.env.AUTOHAND_SQUAD_APP_STATE_DIR)
  : join(rootDir, ".autohand");
const isolatedAgentsDir = join(appStateDir, "agents");
const runLogsDir = join(appStateDir, "run-logs");
// Structured logs (OpenTelemetry Logs Data Model, OTLP/JSON lines). See
// server/otel-logs.mjs and docs/observability.md.
const otelLogsDir = process.env.AUTOHAND_SQUAD_LOGS_DIR
  ? resolve(process.env.AUTOHAND_SQUAD_LOGS_DIR)
  : join(appStateDir, "logs");
const webOtelLogPath = join(otelLogsDir, "web.otlp.jsonl");
const providerSettingsPath = join(appStateDir, "provider-settings.json");
let desktopInstallLocked = false;
let desktopDaemonUpdateToken = "";
async function releaseDesktopDaemonAdmission() {
  const token=desktopDaemonUpdateToken; desktopDaemonUpdateToken="";
  if(token) await updateDaemonAdmission({stateDir:squadStateDir,token,pause:false}).catch(()=>{});
}
const maxRunLogLines = 600;
const childTerminationGraceMs = 2500;
const autohandStateRoot = process.env.AUTOHAND_HOME
  ? resolve(process.env.AUTOHAND_HOME)
  : join(homeDir, ".autohand");
const userConfigPath = process.env.AUTOHAND_USER_CONFIG_PATH
  ? resolve(process.env.AUTOHAND_USER_CONFIG_PATH)
  : join(autohandStateRoot, "config.json");
// The CLI home (model catalog, sessions) sits beside the user config.
const autohandHomeDir = process.env.AUTOHAND_HOME
  ? resolve(process.env.AUTOHAND_HOME)
  : dirname(userConfigPath);
const squadStateDir = process.env.AUTOHAND_SQUAD_HOME
  ? resolve(process.env.AUTOHAND_SQUAD_HOME)
  : join(autohandStateRoot, "squad");
const squadConfigPath = join(squadStateDir, "config.json");
const liveStatusPath = join(squadStateDir, "web-status.json");
const memoryInboxPath = join(squadStateDir, "memory-inbox.json");
const channelsStatePath = join(squadStateDir, "channels.json");
const squadDeviceIdPath = join(squadStateDir, "device-id");
const feedbackBackupDir = join(squadStateDir, "feedback");
const feedbackApiBaseUrl = (process.env.AUTOHAND_SQUAD_API_BASE_URL || process.env.AUTOHAND_API_URL || "https://api.autohand.ai").replace(/\/+$/, "");
const desktopUpdates = createUpdateFlow({
  appStateDir, serviceStateDir: squadStateDir, appVersion: packageMetadata.version || "",
  checkFresh: () => desktopUpdateStatus({ squadStateDir, appVersion: packageMetadata.version || "", refresh: true }),
  canRestart: async ({ automatic = false } = {}) => {
    if (desktopInstallLocked) return false;
    desktopInstallLocked = true;
    try {
      if (automatic) {
        desktopDaemonUpdateToken=randomUUID();
        await updateDaemonAdmission({stateDir:squadStateDir,token:desktopDaemonUpdateToken,pause:true});
      }
      const [savedQueue, queued, diskRuns, activeGoals] = await Promise.all([
        readOptionalJsonFile(join(squadStateDir, "queues.json")), readJsonDir(join(squadStateDir, "queue")), readJsonDir(join(squadStateDir, "runs")), goals.list(),
      ]);
      const active = value => ["pending", "queued", "launching", "running", "handoff-pending"].includes(value.status);
      const busy = activeChats.size || observerRunStarts.size || Boolean(projectObserver.active) || sdkSessions?.stats().busy || [...runs.values()].some(isLiveRun) || activeGoals.some(active) || [...queued, ...diskRuns, ...(savedQueue?.items || [])].some(active);
      if (busy) { desktopInstallLocked = false; await releaseDesktopDaemonAdmission(); }
      return !busy;
    } catch (error) { desktopInstallLocked = false; await releaseDesktopDaemonAdmission(); throw error; }
  },
});
const runs = new Map();
const memberAvailability = new MemberAvailability(squadStateDir);
const activeChats = new Map();
// Finished runs outlive the process (ADR-0113): restored at boot, saved on
// every finish, bounded to the newest 200.
const runHistory = createRunHistory({ path: runHistoryPath(appStateDir), runs, log: (message) => logEvent(SEVERITY.INFO, message, { "event.name": "run.history" }) });
// Previous chats (ADR-0113) read here for recall (ADR-0115); the chats route owns writes.
const chatStore = new ChatStore({ squadStateDir });
let nativeGrantKey = await readNativeComputerGrantKey();
const computerClient = await bundledComputerClient(process.env.AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR ? resolve(process.env.AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR) : rootDir).catch(() => null);
const computerUse = createComputerUse({ stateDir: squadStateDir, rootDir, bridgeUrl: `http://127.0.0.1:${port}`, nativeClient: computerClient, emit: emitBridgeEvent });
const computerWorkRuntimes = new Map();
// Connectors (ADR-0107): MCP servers the person added plus the built-in Web
// research server, injected through the same managed seam as Computer Use.
const connectors = createConnectorStore({ stateDir: squadStateDir, rootDir, nodePath: process.execPath });
const firecrawlBaseUrl = String(process.env.FIRECRAWL_API_URL || "").trim();
// The person's vault (ADR-0104): members reach it only through a managed MCP
// server injected per piece of work, scoped by a per-member credential.
const vault = createVaultService({ stateDir: squadStateDir, rootDir, homeDir, bridgeUrl: `http://127.0.0.1:${port}`, emit: emitBridgeEvent });
const vaultWorkRuntimes = new Map();
bridgeEvents.on("member.stopped", ({ memberId }) => vault.closeMember(memberId));
// The team (ADR-0134): roster, messages between members and shared memory,
// reached by every member through one managed MCP server on any engine.
const team = createTeamService({
  stateDir: squadStateDir,
  rootDir,
  bridgeUrl: `http://127.0.0.1:${port}`,
  members: teamMembers,
  isBusy: (memberId) => isMemberBusy(memberId),
  deliver: deliverTeamMessage,
  runAction: runTeamAction,
  getProfile: async memberId => {
    const access = await agentChannelActions.memberAccess(memberId);
    if (!access?.agent || access.removed) throw new Error("This member is no longer available.");
    const member = access.agent;
    return { id: memberId, name: member.name, role: member.role || "", description: member.description || "", instructions: member.instructions || "", skills: member.skills || [], personality: member.profileFiles?.find(file => file.section === "persona")?.content || "", revision: memberProfileRevision(member) };
  },
  channels: createTeamChannels({ read: () => readChannelsState(), mutate: operation => mutateChannelsState(operation) }),
  getWorkPlan: async memberId => {
    const work = workStoreFor(join(squadStateDir, WORK_STORE_FILE));
    await work.load();
    return work.tasks(memberId).map(({ id, title, detail, due, status, outcome }) => ({ id, title, detail, due, status, outcome }));
  },
  emit: emitBridgeEvent,
});
const teamWorkRuntimes = new Map();
bridgeEvents.on("member.stopped", ({ memberId }) => team.closeMember(memberId));
void team.recover().catch(() => {});

async function teamMembers() {
  const state = await readChannelsState();
  // The app's own utility agents (the squad designer) are registered like
  // members but are not teammates: squad_team listed "Squad member" and a
  // member could message it.
  return Object.entries(state?.agentChannelAccess || {}).filter(([id]) => !isUtilityAgent(id)).map(([id, access]) => ({
    id,
    name: access?.agent?.name || id,
    role: access?.agent?.role || "",
    description: access?.agent?.description || "",
    skills: access?.agent?.skills || [],
    formerNames: access?.agent?.formerNames || [],
    projects: normalizeAgentProjects(access?.agent || {}).map(project => ({ name: project.name || project.label || basename(project.path), path: project.path })),
    engine: harnessAssignmentFromAgent(access?.agent || {}).id || "autohand",
    removed: Boolean(access?.removed),
  }));
}

/**
 * A teammate answers another member's message in a run of its own. When the
 * sender asked from a channel thread, the question and the answer are posted
 * in that thread: before, the exchange was only a run in the Execution panel
 * and the person could not see who said what (bug hunt 2026-10, channels).
 */
async function deliverTeamMessage({ from, to, message, depth, deliveryId, channel = null }) {
  const state = await readChannelsState();
  const access = state?.agentChannelAccess?.[to.id];
  if (!access?.agent || access.removed) return { declined: "missing", reply: `${to.name} is no longer on the team.` };
  await memberAvailability.assertCanWork({ agentId: to.id, agent: access.agent });
  const workspace = access.agent.workspace || normalizeAgentProjects(access.agent)[0]?.path || "";
  const post = (record) => channel && mutateChannelsState((current) => {
    if (!current.channels.some((item) => item.id === channel.channelId) || current.messages.some((item) => item.id === record.id)) return;
    const at = new Date().toISOString();
    current.messages.push({ channelId: channel.channelId, threadId: channel.threadId, parentMessageId: channel.parentMessageId, role: "agent", status: "complete", teamDeliveryId: deliveryId, createdAt: at, updatedAt: at, ...record });
  }).catch(() => {});
  await post({ id: `${deliveryId}-ask`, agentId: from.id, authorName: from.name, body: `@${String(to.name || "").split(/\s+/)[0]} ${String(message || "").trim()}`, targetMemberIds: [to.id] });
  let result;
  try {
    result = await chatOnce({
      agentId: to.id,
      agent: access.agent,
      requestId: deliveryId,
      workspace,
      prompt: teamMessagePrompt(from, message),
      profile: access.profile || "",
      _teamDepth: depth,
      teamMessage: { deliveryId, fromId: from.id, fromName: from.name },
    });
  } catch (error) {
    await post({ id: `${deliveryId}-reply`, agentId: to.id, authorName: to.name, body: `${to.name} could not answer: ${error?.message || error}`, status: "error", relayFromAgentId: from.id });
    throw error;
  }
  const reply = String(result?.reply || "").trim();
  await post({ id: `${deliveryId}-reply`, agentId: to.id, authorName: to.name, body: reply || `${to.name} returned no chat text.`, status: result?.declined ? "error" : "complete", relayFromAgentId: from.id, transport: result?.transport || "" });
  return result;
}

/** A team tool that changes a profile or proposes a schedule runs the SQUAD_ACTION handler. */
async function runTeamAction(type, raw, session) {
  const context = { actorId: session.memberId, identityValid: true, requestId: session.operationId || session.runId || randomUUID(), workspace: session.workspace, depth: session.depth };
  // squad_schedule's timezone is optional; without one the proposal failed
  // and the member had to guess a zone to retry. The person's is this machine's.
  const zoned = type === "schedule" && !raw.timezone && !raw.timeZone && !raw.schedule?.timeZone ? { timezone: bridgeTimeZone() } : {};
  return agentChannelActions.perform(context, { ...raw, ...zoned, type });
}

async function readNativeComputerGrantKey() {
  let file;
  try {
    file = await open(join(squadStateDir, "native-grant-token"), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0) | (fsConstants.O_NONBLOCK || 0));
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size !== 64 || (info.mode & 0o7777) !== 0o600 || (typeof process.getuid === "function" && info.uid !== process.getuid())) return "";
    const value = await file.readFile("utf8");
    if (!/^[a-fA-F0-9]{64}$/.test(value) || (initialNativeGrantKey && value !== initialNativeGrantKey)) return "";
    return value;
  } catch (error) {
    return error.code === "ENOENT" && /^[a-fA-F0-9]{64}$/.test(initialNativeGrantKey) ? initialNativeGrantKey : "";
  } finally { await file?.close(); }
}

async function authorizeComputerUseGrant(req, body) {
  nativeGrantKey = await readNativeComputerGrantKey();
  const received = req.headers["x-squad-native-grant"];
  if (!nativeGrantKey || typeof received !== "string" || !/^[a-fA-F0-9]{64}$/.test(received) || !timingSafeEqual(Buffer.from(received), Buffer.from(nativeGrantKey))) return false;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["memberId", "scope"].includes(key)) || typeof body.memberId !== "string" || !["none", "observe", "control"].includes(body.scope)) return false;
  const snapshot = await readOptionalJsonFile(liveStatusPath);
  return Array.isArray(snapshot?.members) && snapshot.members.some((member) => member.id === body.memberId);
}

async function prepareComputerWork(agentRuntime, input) {
  if (isUtilityAgent(agentRuntime.agentId) || !input._computerUseWorkId) return agentRuntime;
  const grants = await readOptionalJsonFile(join(squadStateDir, "computer-use-grants.json"));
  const scope = grants?.members?.[agentRuntime.agentId]?.scope;
  if (!["observe", "control"].includes(scope)) return agentRuntime;
  const session = await computerUse.createSession({ memberId: agentRuntime.agentId, runId: input._computerUseWorkId });
  const directory = join(agentRuntime.agentHome, "computer-use-configs");
  const configPath = join(directory, `${session.id}.json`);
  const runtime = { ...agentRuntime, configPath, computerUse: session };
  computerWorkRuntimes.set(input._computerUseWorkId, runtime);
  try {
  const config = JSON.parse(await readFile(agentRuntime.configPath, "utf8"));
  const existing = Array.isArray(config.mcp?.servers) ? config.mcp.servers : [];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeSecretFile(configPath, JSON.stringify({ ...config, mcp: { ...config.mcp, enabled: true, servers: [...existing.filter((entry) => entry.name !== "autohand-computer-use"), session.mcpServer] } }, null, 2));
  return runtime;
  } catch (error) { await finishComputerWork(input._computerUseWorkId).catch(() => {}); throw error; }
}

async function finishComputerWork(workId) {
  const runtime = computerWorkRuntimes.get(workId); if (!runtime) return null;
  computerWorkRuntimes.delete(workId);
  try {
    await computerUse.closeSession(runtime.computerUse.id);
    return { sessionId: runtime.computerUse.id, runId: workId, files: await computerUse.evidence(runtime.computerUse.id) };
  } finally {
    await Promise.allSettled([rm(runtime.configPath, { force: true }), ...(runtime.computerUse.externalConfigPath ? [rm(runtime.computerUse.externalConfigPath, { force: true })] : [])]);
  }
}

async function prepareVaultWork(agentRuntime, input) {
  if (isUtilityAgent(agentRuntime.agentId) || !input._computerUseWorkId) return agentRuntime;
  if (!vaultToolsAllowed(normalizeAgentPermissions(agentRuntime.agent))) return agentRuntime;
  const session = await vault.openWork({ memberId: agentRuntime.agentId, runId: input._computerUseWorkId, channelId: input.channel?.id || "" });
  const directory = join(agentRuntime.agentHome, "vault-configs");
  // A stable path keeps the warm SDK session's key (ADR-0030); only an active
  // Computer Use work, whose config is already per work, gets a per-work copy.
  const configPath = join(directory, agentRuntime.computerUse ? `${input._computerUseWorkId}.json` : "member.json");
  const runtime = { ...agentRuntime, configPath, vault: { ...session, perWork: Boolean(agentRuntime.computerUse) } };
  vaultWorkRuntimes.set(input._computerUseWorkId, runtime);
  try {
    const config = JSON.parse(await readFile(agentRuntime.configPath, "utf8"));
    const existing = Array.isArray(config.mcp?.servers) ? config.mcp.servers : [];
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeSecretFile(configPath, JSON.stringify({ ...config, mcp: { ...config.mcp, enabled: true, servers: [...existing.filter((entry) => entry.name !== VAULT_MCP_SERVER_NAME), session.mcpServer] } }, null, 2));
    return runtime;
  } catch (error) { await finishVaultWork(input._computerUseWorkId).catch(() => {}); throw error; }
}

async function finishVaultWork(workId) {
  const runtime = vaultWorkRuntimes.get(workId); if (!runtime) return;
  vaultWorkRuntimes.delete(workId);
  if (runtime.vault.perWork) await Promise.allSettled([rm(runtime.configPath, { force: true }), ...(runtime.vault.externalConfigPath ? [rm(runtime.vault.externalConfigPath, { force: true })] : [])]);
}

async function prepareTeamWork(agentRuntime, input) {
  if (isUtilityAgent(agentRuntime.agentId) || !input._computerUseWorkId) return agentRuntime;
  const engine = harnessAssignmentFromAgent(agentRuntime.agent).id;
  const maxWaitSeconds = engine === "autohand" || engine === "autohand-acp" ? AUTOHAND_TEAM_WAIT_SECONDS : 50;
  const session = await team.openWork({ memberId: agentRuntime.agentId, runId: input._computerUseWorkId, workspace: agentRuntime.workspace, depth: Number(input._teamDepth) || 0, channel: channelContextFromPayload(input), maxWaitSeconds });
  const directory = join(agentRuntime.agentHome, "team-configs");
  // A stable path, as the vault's, keeps a warm session's key (ADR-0030).
  const perWork = Boolean(agentRuntime.computerUse);
  const configPath = join(directory, perWork ? `${input._computerUseWorkId}.json` : "member.json");
  const runtime = { ...agentRuntime, configPath, team: { ...session, perWork } };
  teamWorkRuntimes.set(input._computerUseWorkId, runtime);
  try {
    const config = JSON.parse(await readFile(agentRuntime.configPath, "utf8"));
    const existing = Array.isArray(config.mcp?.servers) ? config.mcp.servers : [];
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeSecretFile(configPath, JSON.stringify({ ...config, mcp: { ...config.mcp, enabled: true, servers: [...existing.filter((entry) => entry.name !== TEAM_MCP_SERVER_NAME), session.mcpServer] } }, null, 2));
    return runtime;
  } catch (error) { await finishTeamWork(input._computerUseWorkId).catch(() => {}); throw error; }
}

async function finishTeamWork(workId) {
  team.finishWork(workId);
  const runtime = teamWorkRuntimes.get(workId); if (!runtime) return;
  teamWorkRuntimes.delete(workId);
  if (runtime.team.perWork) await Promise.allSettled([rm(runtime.configPath, { force: true })]);
}

function teamInstructionsFor(runtime) {
  if (isUtilityAgent(runtime?.agentId) || !runtime?.team) return "";
  return runtime.team.instructions || "";
}

function vaultInstructions(runtime) {
  if (isUtilityAgent(runtime?.agentId) || !runtime?.vault) return "";
  return runtime.vault.instructions || "";
}

function computerUseInstructions(runtime) {
  if (isUtilityAgent(runtime?.agentId)) return "";
  return runtime?.computerUse
    ? "Built-in Computer Use is enabled for this work through Squad's autohand-computer-use MCP server. Discover apps/windows, use explicit pid and window_id, inspect fresh state before acting, and return saved screenshots/annotated action evidence. The proxy checks the human's current member grant and macOS consent on every call; stop and report any permission denial."
    : "Squad has built-in Computer Use. It is not enabled for this work: ask the human to allow Observe or Control in this member's Permissions before operating apps or capturing their screens. Never infer a grant from this instruction or bypass the Squad proxy.";
}

bridgeEvents.on("run.finished", ({ runId }) => {
  void finishComputerWork(runId).then((evidence) => { const run = runs.get(runId); if (run && evidence) run.computerUse = evidence; }).catch(() => {});
  void finishVaultWork(runId).catch(() => {});
  void finishTeamWork(runId).catch(() => {});
});
bridgeEvents.on("computer-use.evidence", (evidence) => {
  const run = runs.get(evidence.runId);
  if (run) run.computerUse = { sessionId: evidence.sessionId, runId: evidence.runId, files: evidence.files };
});
// One bridge-owned turn launcher for goals and member queues (ADR-0111):
// the same chat turn the streaming route runs, with events as callbacks.
const executeBridgeTurn = (payload, { signal, onEvent }) => {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  return executeChatTurn(payload, {
  signal, stream: { send: onEvent }, startedAt: Date.now(),
  });
};
const goals = new GoalManager({
  squadStateDir,
  assertCanWork: async (payload) => {
    if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
    projectObserver.deferMember(String(payload.agentId || payload.agent?.id || ""), "An explicit goal takes priority.");
    await memberAvailability.assertCanWork(payload);
  },
  emit: emitBridgeEvent,
  executeTurn: executeBridgeTurn,
});
// Everything the bridge holds for a member that means "working": the queue
// dispatcher waits for all of it before starting the next follow-up.
async function isMemberBusy(memberId) {
  const id = String(memberId || "");
  if (desktopInstallLocked) return true;
  if (!id) return false;
  if (activeChats.get(id)?.size || observerRunStarts.get(id)) return true;
  if (sdkSessions?.stats().sessions.some((session) => session.agentId === id && session.busy)) return true;
  if ([...runs.values()].some((run) => run.agentId === id && isLiveRun(run))) return true;
  return (await goals.list(id)).some((goal) => goal.status === "running");
}

const observerRunStarts = new Map();
let observerAccountTransition = false;
const projectObserver = new ProjectObserver({
  squadStateDir,
  getRuntimeState: projectObserverRuntimeState,
  review: createProjectObserverReview({ prepareAutohandRuntime: prepareProjectObserverRuntime }),
  emit: emitBridgeEvent,
});
bridgeEvents.on("handoff.pending", event => {
  for (const memberId of [event.fromMemberId, event.toMemberId, event.memberId].filter(Boolean)) projectObserver.deferMember(memberId, "A handoff takes priority.");
});

async function projectObserverRuntimeState(member) {
  const [availability, snapshot, activeGoals, remote, queued, diskRuns] = await Promise.all([
    memberAvailability.get(member.id, member), readOptionalJsonFile(liveStatusPath), goals.list(member.id),
    resolveRemote({ squadStateDir }, member.id), readJsonDir(join(squadStateDir, "queue")), readJsonDir(join(squadStateDir, "runs")),
  ]);
  const idOf = (value) => String(value?.agentId || value?.agent_id || value?.memberId || "");
  const diskBusy = [...queued, ...diskRuns].some(record => idOf(record) === member.id && ["pending", "queued", "launching", "running", "handoff-pending"].includes(record.status));
  const visible = snapshot?.members?.find(record => record.id === member.id);
  const jobs = (snapshot?.jobs || []).filter(record => idOf(record) === member.id && ["pending", "queued", "launching", "running", "handoff-pending"].includes(record.status));
  const jobBusy = jobs.some(job => {
    // A finished bridge run is stronger evidence than a stale browser row.
    const held = runs.get(job.id) || diskRuns.find(run => run.id === job.id);
    return !held || isLiveRun(held);
  });
  // Assignment participants and jobs omitted by the snapshot's 40-row cap
  // still count as assigned work; a held run cannot clear another assignment.
  const snapshotBusy = jobBusy || Boolean(visible?.working || visible?.queuedJobs);
  return {
    signedIn: !observerAccountTransition && readRuntimeAccount().signedIn,
    onBreak: availability.onBreak,
    status: visible?.status || member.status,
    remote: Boolean(remote),
    busy: Boolean(desktopInstallLocked || activeChats.get(member.id)?.size || observerRunStarts.get(member.id) || sdkSessions?.stats().sessions.some(session => session.agentId === member.id && session.busy) || [...runs.values()].some(run => run.agentId === member.id && isLiveRun(run)) || activeGoals.some(goal => goal.status === "running") || diskBusy || snapshotBusy),
  };
}

function registerChat(memberId, controller) {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  projectObserver.deferMember(memberId, "A conversation takes priority.");
  const controllers = activeChats.get(memberId) || new Set();
  controllers.add(controller); activeChats.set(memberId, controllers);
  return () => { controllers.delete(controller); if (!controllers.size) activeChats.delete(memberId); };
}
function stopChats(memberId) {
  projectObserver.deferMember(memberId, "The member was stopped or went on a break.");
  const controllers = activeChats.get(memberId);
  for (const controller of controllers || []) controller.abort();
  return controllers?.size || 0;
}
let server = null;
let shuttingDown = false;
const skilledBaseUrl = "https://skilled.autohand.ai";
const skilledCatalogUrl = `${skilledBaseUrl}/skills-index.json`;
const defaultSkillsRepo = "autohandai/community-skills";
const localCommunitySkillsDir = process.env.AUTOHAND_SKILLS_REPO_DIR
  ? resolve(process.env.AUTOHAND_SKILLS_REPO_DIR)
  : resolve(rootDir, "../../..", "community-skills");
// AUTOHAND_AGENT_SDK_DIR points at a local SDK checkout (for example
// agentsdk/tin-wrapper/typescript) and is used for both the JS entry and the
// bundled per-platform CLI binaries under <dir>/cli.
const localAgentSdkDir = process.env.AUTOHAND_AGENT_SDK_DIR ? resolve(process.env.AUTOHAND_AGENT_SDK_DIR) : "";
const localAgentSdkEntry = process.env.AUTOHAND_AGENT_SDK_ENTRY
  ? resolve(process.env.AUTOHAND_AGENT_SDK_ENTRY)
  : localAgentSdkDir
    ? join(localAgentSdkDir, "dist", "index.js")
  : resolve(rootDir, "../../../agentsdk/tin-wrapper/typescript/dist/index.js");
const skillCatalogCache = { loadedAt: 0, data: null };
const sdkImportCache = { promise: null };
const projectLimitUpperBound = 5;
const maxProjectsPerMember = normalizeProjectLimit(process.env.AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER);
const handoffRetryMode = normalizeHandoffRetryMode(process.env.AUTOHAND_SQUAD_HANDOFF_RETRY_MODE);
// Autohand AI is the first-party provider: it authenticates with the user's
// Autohand account (`autohand login`, synced into every member config) and
// optionally with an API key. The base URL is managed by the CLI unless a
// private gateway is configured. Model ids come from the CLI model catalog.
const AUTOHAND_AI_FALLBACK_MODELS = [
  { id: "auto", label: "Auto", reasoning: true, contextWindow: 262144 },
  { id: "fantail", label: "Fantail", reasoning: false, contextWindow: 262144 },
  { id: "moa", label: "Moa (Thinking)", reasoning: true, contextWindow: 1000000 },
];
const AUTOHAND_AI_DEFAULT_BASE_URL = "https://inference.autohand.ai/v1";
const providerDefinitions = [
  { id: "autohandai", label: "Autohand AI", kind: "cloud", baseUrl: "", model: "auto", requiresApiKey: false, auth: "account" },
  { id: "openrouter", label: "OpenRouter", kind: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", requiresApiKey: true },
  { id: "openai", label: "OpenAI", kind: "cloud", baseUrl: "https://api.openai.com/v1", model: "gpt-5", requiresApiKey: true },
  { id: "ollama", label: "Ollama", kind: "local", baseUrl: "http://127.0.0.1:11434", model: "llama3.1", requiresApiKey: false },
  { id: "bedrock", label: "Amazon Bedrock", kind: "cloud", baseUrl: "", model: "", requiresApiKey: false },
  { id: "llmgateway", label: "LLM Gateway", kind: "cloud", baseUrl: "", model: "", requiresApiKey: true },
  { id: "deepseek", label: "DeepSeek", kind: "cloud", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", requiresApiKey: true },
  { id: "zai", label: "Z.ai", kind: "cloud", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.5", requiresApiKey: true },
  { id: "nvidia", label: "NVIDIA", kind: "cloud", baseUrl: "https://integrate.api.nvidia.com/v1", model: "", requiresApiKey: true },
  { id: "cerebras", label: "Cerebras", kind: "cloud", baseUrl: "https://api.cerebras.ai/v1", model: "", requiresApiKey: true },
];
const providerDefinitionMap = new Map(providerDefinitions.map((provider) => [provider.id, provider]));
const skillAliases = new Map(
  Object.entries({
    "a11y-check": "web-design-guidelines",
    "accessibility-audit": "web-design-guidelines",
    "acceptance-criteria": "task-planning",
    "agent-workflows": "agentic-development-principles",
    "api-contracts": "api-design-restful",
    "api-integration": "api-design-restful",
    "api-reference": "api-documentation",
    "app-store-readiness": "swiftui-expert-skill",
    "blocker-triage": "task-planning",
    "browser-harness": "agent-browser",
    "browser-proof": "agent-browser",
    "change-validation-planner": "testing-strategies",
    "ci-cd": "deployment-automation",
    "compliance-controls": "security-best-practices",
    "content-brief": "content-strategy",
    "dashboard-audit": "looker-studio-bigquery",
    "data-modeling": "database-schema-design",
    "delivery-health": "task-estimation",
    "design-system": "react-component-architecture",
    "design-systems": "tailwind-ui-patterns",
    "developer-docs": "documentation-writing",
    "developer-experience": "cli-tool-development",
    "device-compatibility": "frontend-responsive-design-standards",
    "environment-config": "environment-setup",
    "evaluation-harness": "agent-evaluation",
    "frontend-backend-contracts": "api-design-restful",
    "github-developer-communication": "git-workflow-mastery",
    "insight-summary": "data-analysis",
    "interaction-design": "ui-ux-pro-max",
    "journey-mapping": "ui-ux-pro-max",
    "metric-framing": "data-analysis",
    "migrations": "database-schema-design",
    "mobile-ui": "swiftui-expert-skill",
    "model-integration": "microsoft-foundry",
    "offline-sync": "vercel-react-native-skills",
    "positioning": "product-marketing-context",
    "prioritization": "brainstorming",
    "product-slices": "writing-plans",
    "prompt-systems": "agentic-workflow",
    "prototype-review": "frontend-design",
    "regression-checks": "testing-strategies",
    "release-health": "monitoring-observability",
    "release-notes": "changelog-maintenance",
    "requirements": "writing-plans",
    "responsive": "frontend-responsive-design-standards",
    "responsive-design": "frontend-responsive-design-standards",
    "retrospectives": "brainstorming",
    "risk-review": "documentation-writing",
    "runbooks": "technical-writing",
    "runtime-standards": "environment-setup",
    "secure-code-review": "security-best-practices",
    "secrets-audit": "implementing-secrets-scanning-in-ci-cd",
    "service-reliability": "monitoring-observability",
    "service-templates": "documentation-writing",
    "sprint-planning": "task-planning",
    "sql-review": "database-schema-design",
    "system-design": "api-design-restful",
    "test-case-template": "testing-strategies",
    "threat-modeling": "performing-threat-modeling-with-owasp-threat-dragon",
    "tooling-automation": "workflow-automation",
    "trend-review": "seo-audit",
    "tutorials": "user-guide-writing",
    "workflow-design": "workflow-automation",
  })
);

const vite = isDev
  ? await import("vite").then(({ createServer: createViteServer }) => createViteServer({
      root: rootDir,
      appType: "spa",
      server: {
        middlewareMode: true,
        hmr: {
          host,
          port: Number(args.get("hmr-port") || port + 100),
        },
      },
    }))
  : null;

// The SDK's bundled CLI prints the git commit of the folder it runs in, so
// asked from Squad's own checkout it reported Squad's commit as its build
// ("Autohand Code 0.8.2 (865b66e)"). Asked from outside any repository it
// prints "(unknown)", which says nothing either; that suffix is dropped.
function cliVersionOutput(command) {
  const result = spawnSync(command, ["--version"], { cwd: tmpdir(), encoding: "utf8", timeout: 5000, windowsHide: true });
  const text = result.status === 0 ? result.stdout.trim() : "";
  return text.replace(/\s*\(unknown\)$/i, "");
}

function commandOutput(command, commandArgs = []) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

class SdkBridgeStartupError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "SdkBridgeStartupError";
    this.cause = cause;
  }
}

// Raised before spawning the Autohand CLI when the resolved auth token is
// missing or expired. The CLI runs an interactive `ensureAuthenticated` before
// dispatching `--mode rpc`, and on a non-TTY pipe that drops into a *blocking*
// device-login that prints to stdout (corrupting the JSON-RPC channel) and never
// returns — which the SDK surfaces only as an endless "waiting for the provider"
// stall. Failing fast here turns that silent hang into an actionable message.
class AutohandAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutohandAuthError";
  }
}

// Raised by the first-event watchdog when the CLI accepts the prompt but never
// produces a first event (it exited, rejected auth with an unmatched JSON-RPC
// error, or never reached the provider). Distinct from SdkBridgeStartupError so
// it surfaces to the user instead of triggering a futile CLI fallback that would
// hit the same problem.
class AutohandStallError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutohandStallError";
  }
}

class ChatRuntimeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ChatRuntimeError";
    this.details = details;
  }
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function signalChildProcess(child, signal) {
  if (childHasExited(child)) return false;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Older children may not have been spawned as process-group leaders.
      // Fall back to signaling the direct child below.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function terminateChildProcess(child, { forceAfterMs = childTerminationGraceMs, onForce } = {}) {
  if (childHasExited(child)) return;
  signalChildProcess(child, "SIGTERM");
  const forceTimer = setTimeout(() => {
    if (childHasExited(child)) return;
    onForce?.();
    signalChildProcess(child, "SIGKILL");
  }, forceAfterMs);
  child.once("close", () => clearTimeout(forceTimer));
}

async function loadAgentSdk() {
  if (!sdkImportCache.promise) {
    sdkImportCache.promise = (async () => {
      if (localAgentSdkDir && existsSync(localAgentSdkEntry)) {
        return import(pathToFileURL(localAgentSdkEntry).href);
      }
      try {
        return await import("@autohandai/agent-sdk");
      } catch (packageError) {
        if (!existsSync(localAgentSdkEntry)) {
          throw packageError;
        }
        return import(pathToFileURL(localAgentSdkEntry).href);
      }
    })();
  }
  return sdkImportCache.promise;
}

const cliHelpCache = { text: null };

const bundledAutohandCliNames = new Map([
  ["darwin/arm64", "autohand-macos-arm64"],
  ["darwin/x64", "autohand-macos-x64"],
  ["linux/x64", "autohand-linux-x64"],
  ["linux/arm64", "autohand-linux-arm64"],
  ["win32/x64", "autohand-windows-x64.exe"],
]);

function bundledAutohandCliName() {
  return bundledAutohandCliNames.get(`${osPlatform()}/${arch()}`) || "";
}

function agentSdkPackageDirs() {
  const dirs = [];
  if (localAgentSdkDir) dirs.push(localAgentSdkDir);
  dirs.push(join(rootDir, "node_modules", "@autohandai", "agent-sdk"));
  return dirs;
}

// The vendored CLI (scripts/fetch-autohand-cli.mjs, pinned by package.json
// `autohand.cliVersion`) is the release the app ships. The Agent SDK's own
// bundled build is only a fallback for checkouts that have not fetched it.
const vendoredAutohandCliDir = process.env.AUTOHAND_SQUAD_CLI_DIR
  ? resolve(process.env.AUTOHAND_SQUAD_CLI_DIR)
  : join(rootDir, "vendor", "autohand-cli");
const inspectAutohandCli = createCliProbe();
const cliBootstrap = createCliBootstrap({
  stateDir: appStateDir,
  version: String(packageMetadata.autohand?.cliVersion || ""),
  repository: String(packageMetadata.autohand?.cliRepository || "autohandai/code-cli"),
  locate: () => resolveAutohandBinaryDetailed(),
});

function vendoredAutohandCliInfo() {
  try {
    return JSON.parse(readFileSync(join(vendoredAutohandCliDir, "BUILD_INFO.json"), "utf8"));
  } catch {
    return null;
  }
}

function resolveAutohandBinaryDetailed() {
  const usable = (path, source, pinned = false) => {
    const probe = inspectAutohandCli(path, pinned ? { expectedVersion: packageMetadata.autohand.cliVersion } : {});
    return probe ? { path, source, version: probe.output } : null;
  };
  const explicit = String(process.env.AUTOHAND_SQUAD_AUTOHAND_BIN || "").trim();
  if (explicit) { const selected = usable(explicit, "explicit"); if (selected) return selected; }

  const bundledName = bundledAutohandCliName();
  if (bundledName) {
    const vendored = join(vendoredAutohandCliDir, bundledName);
    const selected = usable(vendored, "vendored", true) || usable(cliBootstrap.path, "managed", true);
    if (selected) return selected;
    for (const packageDir of agentSdkPackageDirs()) {
      const bundled = join(packageDir, "cli", bundledName);
      const selected = usable(bundled, "agent-sdk");
      if (selected) return selected;
    }
  }

  const finder = osPlatform() === "win32" ? "where" : "which";
  const onPath = commandOutput(finder, ["autohand"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return usable(onPath, "path") || { path: "", source: "none", version: "" };
}

function resolveAutohandBinary() {
  return resolveAutohandBinaryDetailed().path;
}

function autohandHelpText() {
  if (cliHelpCache.text === null) {
    const autohandPath = resolveAutohandBinary();
    if (!autohandPath) return "";
    const text = commandOutput(autohandPath, ["--help"]);
    // A CLI that is installed later must be re-probed; only cache real output.
    if (text.trim()) cliHelpCache.text = text;
    return text;
  }
  return cliHelpCache.text;
}

function autohandSupportsFlag(flag) {
  return autohandHelpText().includes(flag);
}

function getRuntime() {
  const resolved = resolveAutohandBinaryDetailed();
  const autohandPath = resolved.path;
  const version = resolved.version || "";
  const vendored = vendoredAutohandCliInfo();
  return {
    autohandPath,
    autohandSource: resolved.source,
    pinnedCliVersion: String(packageMetadata.autohand?.cliVersion || ""),
    vendoredCliVersion: vendored?.version || "",
    version,
    squadVersion: packageMetadata.version || "0.0.0",
    available: Boolean(autohandPath),
    bootstrap: cliBootstrap.status(),
    defaultWorkspace: getDefaultWorkspace(),
    // Names this machine in the relay workspace switcher and member ownership.
    hostName: hostname(),
    workspaceRoot: homeDir,
    squadWorkspaceRoot,
    legacySquadWorkspaceRoots,
    limits: {
      maxProjectsPerMember,
    },
    features: {
      workspaceFileMentions: true,
    },
    handoffs: {
      recommendationConfirmationRequired: false,
      retryMode: handoffRetryMode,
    },
    account: readRuntimeAccount(),
    observability: {
      logFormat: "otlp-json",
      logsDir: otelLogsDir,
      runLogsDir,
      exportEnabled: otel.exportEnabled,
      exportEndpoint: otel.exportEnabled ? maskEndpoint(otel.exporter.endpoint) : "",
      exportFailures: otel.exportFailures,
      lastExportError: otel.lastExportError,
    },
    sessions: sdkSessions ? sdkSessions.stats() : { active: 0, busy: 0, sessions: [] },
    harnesses: {
      default: DEFAULT_HARNESS_ID,
      ids: ["autohand", "codex", "claude"],
      sdkSource: localAgentSdkDir ? "local-dir" : "package",
    },
    serverStartedAt,
  };
}

function maskEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

function autohandReadinessContext() {
  const bundledPath = resolveAutohandBinary();
  const account = readRuntimeAccount();
  return {
    bundledPath,
    accountEmail: account.email || "",
    version: bundledPath ? cliVersionOutput(bundledPath) : "",
    authReady: autohandAuthUsable(readAutohandAuth(userConfigPath)),
  };
}

function harnessContextFor(id) {
  if (id === DEFAULT_HARNESS_ID) return autohandReadinessContext();
  // ACP agents (ADR-0122): the registry cache lives in the squad state dir
  // and `autohand-acp` runs the same CLI the Autohand engine uses.
  if (id === "acp" || isAcpHarness(id)) return { squadStateDir, autohandPath: resolveAutohandBinary() };
  return {};
}

const serverStartedAt = new Date().toISOString();

function readJsonFileSync(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function authEmail(auth) {
  if (!auth || typeof auth !== "object") return "";
  return String(auth.email || auth.accountEmail || auth.user?.email || "").trim();
}

function readRuntimeAccount() {
  const squadConfig = readJsonFileSync(squadConfigPath);
  const userAuth = readAutohandAuth(userConfigPath);
  const squadEmail = String(squadConfig?.accountEmail || "").trim();
  const userEmail = authEmail(userAuth);
  const squadSignedIn = Boolean(String(squadConfig?.apiAuthToken || "").trim());
  const userSignedIn = autohandAuthUsable(userAuth);
  const profile = userAuth?.user && typeof userAuth.user === "object" ? userAuth.user : {};
  return {
    signedIn: squadSignedIn || userSignedIn,
    email: squadEmail || userEmail,
    name: String(profile.name || "").trim(),
    userId: String(profile.id || profile.userId || "").trim() || undefined,
    avatar: String(profile.avatar || "").trim(),
    source: squadSignedIn ? "squad-runtime" : userSignedIn ? "autohand-cli" : "none",
  };
}

// Sign out of the Autohand account. The session is shared with the Autohand
// CLI (~/.autohand/config.json), so signing out here signs the CLI out too;
// provider, permission, and profile settings are kept. The Squad CLI's
// `squad logout` is preferred (one code path with the desktop app); without
// it the bridge clears the same files itself.
async function signOutAccount() {
  observerAccountTransition = true;
  if (projectObserver.active) projectObserver.deferMember(projectObserver.active.memberId, "The account is signing out.");
  try {
  const before = readRuntimeAccount();
  for (const memberId of new Set((await goals.list()).filter((goal) => goal.status === "running").map((goal) => goal.agentId))) await goals.pauseForMember(memberId, "Account signed out. Resume after signing in.");
  for (const memberId of activeChats.keys()) stopChats(memberId);
  let via = "bridge";
  const squadCli = locateSquadCliBinary();
  if (squadCli) {
    const result = spawnSync(squadCli, ["logout"], {
      encoding: "utf8",
      env: { ...process.env, AUTOHAND_SQUAD_HOME: squadStateDir },
      timeout: 15000,
    });
    if (result.status === 0) via = "squad-cli";
    else logEvent(SEVERITY.WARN, `squad logout failed: ${String(result.stderr || result.stdout || result.error?.message || "").trim()}`, { "event.name": "account.logout.cli_failed" });
  }
  if (via === "bridge") {
    clearAutohandAuthToken(userConfigPath);
    clearSquadSession(squadConfigPath);
    const daemonRecord = await readOptionalJsonFile(join(squadStateDir, "daemon.json"));
    if (daemonRecord?.url) {
      await fetchWithTimeout(`${String(daemonRecord.url).replace(/\/+$/, "")}/auth/logout`, { method: "POST" }, 3000).catch(() => null);
    }
  }
  if (sdkSessions) await sdkSessions.closeAll("signed out").catch(() => 0);
  await Promise.allSettled([...computerWorkRuntimes.keys()].map(finishComputerWork));
  harnessLogins.cancel("autohand");
  logEvent(SEVERITY.INFO, "account signed out", { "event.name": "account.logout", "autohand.logout.via": via });
  return { via, previousEmail: before.email, account: readRuntimeAccount() };
  } finally { observerAccountTransition = false; }
}

function clearAutohandAuthToken(configPath) {
  const config = readJsonFileSync(configPath);
  if (!config || typeof config !== "object" || !config.auth || typeof config.auth !== "object") return;
  const { token, expiresAt, refreshToken, ...rest } = config.auth;
  void token;
  void expiresAt;
  void refreshToken;
  writeFileSync(configPath, `${JSON.stringify({ ...config, auth: rest }, null, 2)}\n`, { mode: 0o600 });
}

function clearSquadSession(configPath) {
  const config = readJsonFileSync(configPath);
  if (!config || typeof config !== "object") return;
  writeFileSync(configPath, `${JSON.stringify({ ...config, apiAuthToken: "", accountEmail: "" }, null, 2)}\n`, { mode: 0o600 });
}

function executableName(binaryName) {
  return osPlatform() === "win32" ? `${binaryName}.exe` : binaryName;
}

function locateSquadTrayBinary() {
  const explicit = process.env.AUTOHAND_SQUAD_TRAY;
  if (explicit && existsSync(explicit)) return explicit;
  const name = executableName("autohand-squad-tray");
  const candidates = [
    join(squadStateDir, "bin", name),
    join(rootDir, "daemon", "target", "debug", name),
    join(rootDir, "daemon", "target", "release", name),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

// The `squad` CLI (bundled as a desktop sidecar) can run the account device
// flow without a tray binary; the bridge prefers it when present.
function locateSquadCliBinary() {
  const explicit = process.env.AUTOHAND_SQUAD_CLI;
  if (explicit && existsSync(explicit)) return explicit;
  const name = executableName("squad");
  const candidates = [
    join(dirname(process.execPath), name),
    join(rootDir, "..", name),
    join(squadStateDir, "bin", name),
    join(rootDir, "daemon", "target", "release", name),
    join(rootDir, "daemon", "target", "debug", name),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function requestSquadBrowserLogin() {
  const trayBinary = locateSquadTrayBinary();
  if (!trayBinary) {
    throw new Error("Autohand Squad tray binary was not found. Use the menu bar Login action or rebuild the runtime, then retry.");
  }

  const child = spawn(trayBinary, ["--action", "login"], {
    cwd: rootDir,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      AUTOHAND_SQUAD_HOME: squadStateDir,
    },
  });
  return {
    started: true,
    message: "Opened the existing Autohand Squad browser login flow.",
  };
}

// Provider keys and copied Autohand auth tokens must never be world-readable.
async function writeSecretFile(path, content) {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    await chmod(path, 0o600).catch(() => {});
  }
}

// Same-origin guard for the local bridge: browsers attach an Origin header to
// cross-site requests (including no-preflight text/plain POSTs), so a request
// carrying an Origin that is not this bridge is rejected. Requests without an
// Origin (curl, the Rust launcher, same-origin GETs) are unaffected.
function requestOriginAllowed(req, url) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const sameHost = ["127.0.0.1", "localhost", "[::1]", "::1", host].includes(parsed.hostname);
    return sameHost && (parsed.port === String(port) || parsed.port === url.port);
  } catch {
    return false;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "connection": "close",
  });
  res.end(body);
}

function startEventStream(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  return {
    send(event, data = {}) {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!res.destroyed && !res.writableEnded) {
        res.end();
      }
    },
  };
}

class RequestTooLargeError extends Error {
  constructor(maxBytes) {
    super(`request body too large (limit ${maxBytes} bytes)`);
    this.name = "RequestTooLargeError";
    this.status = 413;
  }
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    // Decode through the stream's StringDecoder so multi-byte characters that
    // straddle chunk boundaries are not corrupted.
    let overflow = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (overflow) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        // Stop buffering but keep draining so the 413 response is delivered
        // instead of the socket being torn down mid-request.
        overflow = true;
        body = "";
        reject(new RequestTooLargeError(maxBytes));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (overflow) return;
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function isInsideHome(path) {
  const diff = relative(homeDir, path);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function isHomeDir(path) {
  return resolve(path) === homeDir;
}

function isPathInside(path, root) {
  const diff = relative(root, path);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function isRunnableWorkspace(path) {
  return isInsideHome(path) && !isHomeDir(path);
}

function normalizeSquadWorkspacePath(path) {
  const resolvedPath = resolve(path);
  for (const legacyRoot of legacySquadWorkspaceRoots) {
    if (isPathInside(resolvedPath, legacyRoot)) {
      return join(squadWorkspaceRoot, relative(legacyRoot, resolvedPath));
    }
  }
  return resolvedPath;
}

function isSquadManagedWorkspace(path) {
  if (!isPathInside(path, squadWorkspaceRoot)) return false;
  const parts = relative(squadWorkspaceRoot, path).split(/[/\\]+/).filter(Boolean);
  return parts[0] === "data" && parts[1] === "workers" && Boolean(parts[2]);
}

async function ensureSquadManagedWorkspace(path) {
  if (isSquadManagedWorkspace(path) && !existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspace() {
  const candidates = [
    ...(isPackagedRuntime ? [] : [rootDir]),
    join(homeDir, "Documents", "autohand"),
    join(homeDir, "Documents"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory() && isRunnableWorkspace(candidate)) || "";
}

async function cleanWorkspace(workspace) {
  if (typeof workspace !== "string" || !workspace.trim()) {
    throw new Error("workspace is required; choose a local project folder or git repo");
  }
  const value = workspace.trim();
  const requested = resolve(value.replace(/\/+$/, "") || value);
  const resolved = normalizeSquadWorkspacePath(requested);
  await ensureSquadManagedWorkspace(resolved);
  if (!isInsideHome(resolved)) {
    throw new Error("workspace must be a folder inside the user directory");
  }
  if (isHomeDir(resolved)) {
    throw new Error("the home directory is blocked by Autohand CLI; choose a project folder or git repo");
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("workspace folder does not exist");
  }
  return resolved;
}

const ignoredWorkspaceDirs = new Set([
  ".cache",
  ".git",
  ".local",
  ".npm",
  ".pnpm-store",
  "Applications",
  "cachedir_joblib",
  "Library",
  "Movies",
  "Music",
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
]);

const ignoredFileDirs = new Set([
  ...ignoredWorkspaceDirs,
  ".git",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

const fileSuggestionLimit = 12;
const workspaceProfileCache = new Map();

const workspaceMarkers = [
  ".git",
  "AGENTS.md",
  "bun.lock",
  "Cargo.toml",
  "Gemfile",
  "go.mod",
  "package.json",
  "Package.swift",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "tsconfig.json",
  "vite.config.js",
];

const priorityWorkspaceDirs = new Set([
  "apps",
  "autohand",
  "Code",
  "code",
  "Developer",
  "dev",
  "Documents",
  "packages",
  "Projects",
  "projects",
  "prototypes",
  "repos",
  "web",
  "workspace",
  "workspaces",
]);

function shouldSkipWorkspaceDir(name) {
  return name.startsWith(".") || ignoredWorkspaceDirs.has(name);
}

async function listWorkspaces() {
  const maxDepth = 7;
  const maxScannedDirs = 6000;
  const queue = [{ path: homeDir, depth: 0 }];
  const seen = new Set([homeDir]);
  const byPath = new Map();
  let scannedDirs = 0;

  function addWorkspace(path, depth, label = relative(homeDir, path), kind = "folder") {
    if (!isRunnableWorkspace(path) || byPath.has(path)) return;
    byPath.set(path, {
      label,
      name: basename(path),
      path,
      depth,
      kind,
      launchable: true,
    });
  }

  if (!isPackagedRuntime && isRunnableWorkspace(rootDir)) {
    addWorkspace(rootDir, relative(homeDir, rootDir).split(/[/\\]/).length, relative(homeDir, rootDir), "current");
  }

  while (queue.length && scannedDirs < maxScannedDirs) {
    const current = queue.shift();
    scannedDirs += 1;
    let entries = [];
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    const entryNames = new Set(entries.map((entry) => entry.name));
    const relPath = relative(homeDir, current.path);
    const isProjectFolder =
      current.depth <= 2 ||
      workspaceMarkers.some((marker) => entryNames.has(marker)) ||
      entries.some((entry) => entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcworkspace"));

    if (current.depth > 0 && isProjectFolder) {
      const kind = entryNames.has(".git") ? "git repo" : workspaceMarkers.some((marker) => entryNames.has(marker)) ? "project" : "folder";
      addWorkspace(current.path, current.depth, relPath, kind);
    }

    const dirs = entries
      .filter((entry) => entry.isDirectory() && !shouldSkipWorkspaceDir(entry.name))
      .sort((a, b) => {
        const priorityDelta =
          Number(priorityWorkspaceDirs.has(b.name)) - Number(priorityWorkspaceDirs.has(a.name));
        return priorityDelta || a.name.localeCompare(b.name);
      });

    for (const entry of dirs) {
      const fullPath = join(current.path, entry.name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      if (current.depth + 1 <= maxDepth) {
        queue.push({ path: fullPath, depth: current.depth + 1 });
      }
    }
  }

  const currentWorkspace = isPackagedRuntime ? null : byPath.get(rootDir);
  const sorted = Array.from(byPath.values()).sort((a, b) => a.label.localeCompare(b.label));
  return currentWorkspace
    ? [currentWorkspace, ...sorted.filter((workspace) => workspace.path !== rootDir)]
    : sorted;
}

async function listWorkspaceFiles(workspace, query = "") {
  const resolvedWorkspace = await cleanWorkspace(workspace);
  const normalizedQuery = String(query || "").trim().toLowerCase().slice(0, 120);
  const gitFiles = listGitWorkspaceFiles(resolvedWorkspace);
  const files = gitFiles || await listFallbackWorkspaceFiles(resolvedWorkspace);
  return files
    .filter((file) => {
      const normalizedFile = file.toLowerCase();
      return !normalizedQuery || normalizedFile.includes(normalizedQuery);
    })
    .slice(0, fileSuggestionLimit)
    .map((file) => ({
      type: "file",
      path: file,
      label: file,
      detail: "Workspace file",
    }));
}

function listGitWorkspaceFiles(workspace) {
  const rootResult = spawnSync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (rootResult.status !== 0) return null;

  const repoRoot = rootResult.stdout.trim();
  if (!repoRoot || !isPathInside(workspace, repoRoot)) return null;

  const filesResult = spawnSync("git", ["-C", repoRoot, "ls-files", "-co", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 4000,
  });
  if (filesResult.status !== 0) return null;

  const workspacePrefix = toPosixPath(relative(repoRoot, workspace));
  const prefix = workspacePrefix && workspacePrefix !== "." ? `${workspacePrefix}/` : "";
  return filesResult.stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !prefix || file.startsWith(prefix))
    .map((file) => (prefix ? file.slice(prefix.length) : file))
    .filter((file) => file && !file.split("/").some((part) => ignoredFileDirs.has(part)))
    .sort((a, b) => a.localeCompare(b));
}

async function listFallbackWorkspaceFiles(workspace) {
  const ignoreRules = await readRootGitignoreRules(workspace);
  const queue = [{ path: workspace, depth: 0 }];
  const files = [];
  let scannedDirs = 0;

  while (queue.length && scannedDirs < 2000 && files.length < 800) {
    const current = queue.shift();
    scannedDirs += 1;
    let entries = [];
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(current.path, entry.name);
      const relativePath = toPosixPath(relative(workspace, fullPath));
      if (!relativePath || shouldIgnoreWorkspaceFile(relativePath, entry.isDirectory(), ignoreRules)) continue;

      if (entry.isDirectory()) {
        if (current.depth < 6) queue.push({ path: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile()) files.push(relativePath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function readRootGitignoreRules(workspace) {
  try {
    const content = await readFile(join(workspace, ".gitignore"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => ({
        negated: line.startsWith("!"),
        pattern: line.replace(/^!/, "").replace(/^\/+/, ""),
      }))
      .filter((rule) => rule.pattern);
  } catch {
    return [];
  }
}

function shouldIgnoreWorkspaceFile(relativePath, isDirectory, rules) {
  const parts = relativePath.split("/");
  if (parts.some((part) => ignoredFileDirs.has(part))) return true;

  let ignored = false;
  for (const rule of rules) {
    if (matchesGitignoreRule(relativePath, isDirectory, rule.pattern)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function matchesGitignoreRule(relativePath, isDirectory, pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (!normalized) return false;

  if (normalized.endsWith("/")) {
    const dirPattern = normalized.slice(0, -1);
    return isDirectory
      ? relativePath === dirPattern || relativePath.startsWith(`${dirPattern}/`) || relativePath.split("/").includes(dirPattern)
      : relativePath.startsWith(`${dirPattern}/`) || relativePath.split("/").includes(dirPattern);
  }

  if (!normalized.includes("/") && !normalized.includes("*")) {
    return relativePath.split("/").includes(normalized) || relativePath.endsWith(`/${normalized}`);
  }

  if (!normalized.includes("*")) {
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  }

  const escaped = normalized
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`(^|/)${escaped}($|/)`).test(relativePath);
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitizeAgentId(input) {
  const value = String(input || "default").trim().toLowerCase();
  const safe = value.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const legacyPrefix = legacySquadMemberIdPrefixes.find((prefix) => safe.startsWith(prefix));
  return legacyPrefix ? `${squadMemberIdPrefix}${safe.slice(legacyPrefix.length)}` : safe || "default";
}

function sanitizeSkillId(input) {
  const raw = String(input || "")
    .trim()
    .replace(/^@?skill\//i, "")
    .replace(/^https:\/\/skilled\.autohand\.ai\/skill\//i, "")
    .toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return skillAliases.get(safe) || safe;
}

function uniqueSkillIds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const skills = [];
  for (const item of input) {
    const id = sanitizeSkillId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skills.push(id);
  }
  return skills;
}

function safePathSegment(input) {
  const value = String(input || "").trim();
  if (!value || value.includes("\0") || isAbsolute(value)) return "";
  const normalized = normalize(value).replace(/^[/\\]+/, "");
  if (normalized === "." || normalized.startsWith("..") || normalized.split(/[/\\]/).includes("..")) {
    return "";
  }
  return normalized;
}

function safeJoin(basePath, relativePath) {
  const safeRelativePath = safePathSegment(relativePath);
  if (!safeRelativePath) {
    throw new Error(`unsafe skill path: ${relativePath}`);
  }
  const base = resolve(basePath);
  const target = resolve(base, safeRelativePath);
  const diff = relative(base, target);
  if (diff.startsWith("..") || isAbsolute(diff)) {
    throw new Error(`unsafe skill path: ${relativePath}`);
  }
  return target;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadSkillCatalog() {
  const now = Date.now();
  if (skillCatalogCache.data && now - skillCatalogCache.loadedAt < 5 * 60 * 1000) {
    return skillCatalogCache.data;
  }

  const catalogCandidates = [
    async () => {
      const response = await fetchWithTimeout(skilledCatalogUrl, {}, 10000);
      if (!response.ok) throw new Error(`catalog returned ${response.status}`);
      return response.json();
    },
    async () => readJsonFile(join(localCommunitySkillsDir, "registry.json")),
    async () => {
      const response = await fetchWithTimeout(
        "https://raw.githubusercontent.com/autohandai/community-skills/HEAD/registry.json",
        {},
        10000
      );
      if (!response.ok) throw new Error(`registry returned ${response.status}`);
      return response.json();
    },
  ];

  for (const loadCatalog of catalogCandidates) {
    try {
      const catalog = await loadCatalog();
      if (catalog && Array.isArray(catalog.skills)) {
        skillCatalogCache.data = catalog;
        skillCatalogCache.loadedAt = now;
        return catalog;
      }
    } catch {
      // Try the next catalog source; the local clone keeps agent creation usable offline.
    }
  }

  return { skills: [] };
}

function normalizeSkillFileList(skill) {
  const files = Array.isArray(skill.files) && skill.files.length ? skill.files : ["SKILL.md"];
  const safeFiles = files.map(safePathSegment).filter(Boolean);
  return safeFiles.includes("SKILL.md") ? safeFiles : ["SKILL.md", ...safeFiles];
}

async function readLocalSkillFiles(skill) {
  if (!existsSync(localCommunitySkillsDir)) return null;
  const directory = safePathSegment(skill.directory || skill.id);
  if (!directory) return null;
  const skillRoot = safeJoin(localCommunitySkillsDir, directory);
  if (!existsSync(skillRoot)) return null;

  const files = new Map();
  for (const file of normalizeSkillFileList(skill)) {
    const filePath = safeJoin(skillRoot, file);
    if (!existsSync(filePath)) return null;
    files.set(file, await readFile(filePath, "utf8"));
  }
  return files;
}

function skillRepo(skill) {
  const source = String(skill.source || "").trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source) ? source : defaultSkillsRepo;
}

function githubRawUrl(repo, branch, filePath) {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${encodedPath}`;
}

async function fetchRemoteSkillFiles(skill) {
  const directory = safePathSegment(skill.directory || skill.id);
  if (!directory) {
    throw new Error("skill has no safe directory");
  }

  const repo = skillRepo(skill);
  const files = normalizeSkillFileList(skill);
  const branches = ["HEAD", "main", "master"];
  let lastError = null;

  for (const branch of branches) {
    const fetchedFiles = new Map();
    try {
      for (const file of files) {
        const response = await fetchWithTimeout(githubRawUrl(repo, branch, `${directory}/${file}`), {}, 15000);
        if (!response.ok) throw new Error(`${file} returned ${response.status}`);
        fetchedFiles.set(file, await response.text());
      }
      return fetchedFiles;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("could not fetch skill files");
}

async function getSkillFiles(skill) {
  const localFiles = await readLocalSkillFiles(skill);
  if (localFiles) return localFiles;
  return fetchRemoteSkillFiles(skill);
}

function skillSummary(skill) {
  return {
    id: skill.id,
    name: skill.name || skill.id,
    category: skill.category || "",
    author: skill.author || "",
    source: skill.source || defaultSkillsRepo,
    url: skill.url || `${skilledBaseUrl}/skill/${skill.id}`,
  };
}

async function installAgentSkills(agent, agentHome, agentId) {
  const requestedSkills = uniqueSkillIds(agent.skills);
  const skillsDir = join(agentHome, "skills");
  const displaySkillsDir = `.autohand/agents/${agentId}/skills`;
  await mkdir(skillsDir, { recursive: true });
  // Removed skills must leave the runtime's active discovery directory. Keep
  // authored bytes outside the agent home so re-enabling can restore them.
  const disabledDir = join(isolatedAgentsDir, "disabled-skills", agentId);
  const requested = new Set(requestedSkills);
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || requested.has(entry.name) || !existsSync(join(skillsDir, entry.name, "SKILL.md"))) continue;
    await mkdir(disabledDir, { recursive: true });
    const target = join(disabledDir, entry.name);
    if (existsSync(target)) throw new Error(`Cannot disable ${entry.name}: a retained copy already exists. Resolve the duplicate before retrying.`);
    await rename(join(skillsDir, entry.name), target);
  }
  for (const id of requestedSkills) {
    const retained = join(disabledDir, id);
    if (existsSync(join(retained, "SKILL.md")) && !existsSync(join(skillsDir, id))) await rename(retained, join(skillsDir, id));
  }

  if (!requestedSkills.length) {
    const emptyInstall = {
      source: skilledBaseUrl,
      repository: defaultSkillsRepo,
      path: skillsDir,
      displayPath: displaySkillsDir,
      requested: [],
      installed: [],
      failed: [],
      updatedAt: new Date().toISOString(),
    };
    await writeFile(join(skillsDir, "installed-skills.json"), JSON.stringify(emptyInstall, null, 2), "utf8");
    return emptyInstall;
  }

  // Skills the person already has on this machine answer first. A skill in
  // ~/.claude/skills used to be invisible here, so asking for it produced
  // "not found in Skilled catalog" however plainly it was sitting on disk.
  const localRoots = localSkillRoots({ homeDir, squadStateDir, workspace: String(agent?.workspace || "") });
  const localById = new Map((await listLocalSkills(localRoots)).map((skill) => [skill.id, skill]));

  const catalog = await loadSkillCatalog().catch(() => ({ skills: [] }));
  const catalogById = new Map((catalog?.skills || []).map((skill) => [skill.id, skill]));
  const install = {
    source: skilledBaseUrl,
    repository: defaultSkillsRepo,
    path: skillsDir,
    displayPath: displaySkillsDir,
    requested: requestedSkills,
    installed: [],
    failed: [],
    updatedAt: new Date().toISOString(),
  };

  for (const skillId of requestedSkills) {
    const presentPath = join(skillsDir, skillId, "SKILL.md");
    if (existsSync(presentPath)) {
      install.installed.push({ id: skillId, name: skillId, source: "member-home", status: "present", path: presentPath });
      continue;
    }
    const local = localById.get(skillId);
    if (local) {
      const targetDir = join(skillsDir, skillId);
      const skillPath = join(targetDir, "SKILL.md");
      const summary = { id: local.id, name: local.name, category: local.category, author: "", source: "local", url: "" };
      if (existsSync(skillPath)) {
        install.installed.push({ ...summary, status: "present", path: skillPath });
        continue;
      }
      try {
        for (const [relativePath, content] of await readSkillFolder(local.dir)) {
          const targetPath = safeJoin(targetDir, relativePath);
          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, content, "utf8");
        }
        install.installed.push({ ...summary, status: "installed", path: skillPath, from: local.root });
      } catch (error) {
        install.failed.push({ id: skillId, status: "error", reason: `could not copy from ${local.root}: ${error.message}` });
      }
      continue;
    }

    const skill = catalogById.get(skillId);
    if (!skill) {
      install.failed.push({
        id: skillId,
        status: "missing",
        reason: `not in the Skilled catalog, and no SKILL.md under ${localRoots.length} local skill folders`,
      });
      continue;
    }

    const targetDir = join(skillsDir, skillId);
    const skillPath = join(targetDir, "SKILL.md");
    const summary = skillSummary(skill);
    if (existsSync(skillPath)) {
      install.installed.push({ ...summary, status: "present", path: skillPath });
      continue;
    }

    try {
      const files = await getSkillFiles(skill);
      for (const [relativePath, content] of files) {
        const targetPath = safeJoin(targetDir, relativePath);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, "utf8");
      }
      install.installed.push({ ...summary, status: "installed", path: skillPath });
    } catch (error) {
      install.failed.push({
        id: skillId,
        status: "failed",
        reason: error instanceof Error ? error.message : "could not install skill",
      });
    }
  }

  await writeFile(join(skillsDir, "installed-skills.json"), JSON.stringify(install, null, 2), "utf8");
  return install;
}

function defaultAgentConfig(workspace) {
  return {
    provider: "autohandai",
    autohandai: {
      plan: "cloud",
      authMode: "account",
      model: "auto",
    },
    workspace: {
      defaultRoot: workspace,
      allowDangerousOps: false,
    },
    ui: {
      theme: "dark",
      autoConfirm: false,
      silentToolOutput: false,
      completionReportEnabled: true,
      activityVerbsEnabled: true,
      promptSuggestions: true,
    },
    telemetry: {
      enabled: false,
    },
    autoReport: {
      enabled: true,
    },
    agent: {
      toolSelectionCache: true,
      idleLogoutEnabled: false,
    },
  };
}

function providerTemplate(providerId) {
  const definition = providerDefinitionMap.get(providerId) || providerDefinitions[0];
  return {
    id: definition.id,
    enabled: definition.id === "autohandai",
    apiKey: "",
    baseUrl: definition.baseUrl || "",
    model: definition.model || "",
    region: "",
    profile: "",
  };
}

function normalizedProviderId(value, fallback = "autohandai") {
  const providerId = String(value || "").trim().toLowerCase();
  return providerDefinitionMap.has(providerId) ? providerId : fallback;
}

function normalizeProviderRecord(providerId, source = {}, previous = null) {
  const template = providerTemplate(providerId);
  const current = source && typeof source === "object" ? source : {};
  const prior = previous && typeof previous === "object" ? previous : {};
  const rawApiKey = current.apiKey;
  const apiKey =
    rawApiKey === undefined || rawApiKey === null || rawApiKey === ""
      ? String(prior.apiKey || template.apiKey || "")
      : String(rawApiKey);

  return {
    ...template,
    ...prior,
    ...current,
    id: providerId,
    enabled: current.enabled === undefined ? prior.enabled === true || template.enabled === true : current.enabled === true,
    apiKey,
    baseUrl: String(current.baseUrl ?? prior.baseUrl ?? template.baseUrl ?? "").trim(),
    model: String(current.model ?? prior.model ?? template.model ?? "").trim(),
    region: String(current.region ?? prior.region ?? template.region ?? "").trim(),
    profile: String(current.profile ?? prior.profile ?? template.profile ?? "").trim(),
  };
}

function normalizeProviderSettings(input = {}, previous = null) {
  const source = input && typeof input === "object" ? input : {};
  const prior = previous && typeof previous === "object" ? previous : {};
  const sourceProviders = source.providers && typeof source.providers === "object" ? source.providers : {};
  const priorProviders = prior.providers && typeof prior.providers === "object" ? prior.providers : {};
  const providers = {};

  for (const definition of providerDefinitions) {
    providers[definition.id] = normalizeProviderRecord(
      definition.id,
      sourceProviders[definition.id],
      priorProviders[definition.id]
    );
  }

  let defaultProvider = normalizedProviderId(source.defaultProvider || prior.defaultProvider);
  // Settings written before Autohand AI existed (version 1) move to the
  // first-party default once, but only when the account can actually run it;
  // an unauthenticated workspace keeps its working provider.
  const storedVersion = Number(source.version || prior.version || 0);
  if (storedVersion < 2 && defaultProvider !== "autohandai" && autohandAiAccountReady()) {
    defaultProvider = "autohandai";
  }
  if (providers[defaultProvider]) {
    providers[defaultProvider].enabled = true;
  }

  return {
    version: 2,
    defaultProvider,
    providers,
    updatedAt: String(source.updatedAt || prior.updatedAt || new Date().toISOString()),
  };
}

function providerSettingsFromAutohandConfig(config) {
  if (!config || typeof config !== "object") return normalizeProviderSettings();
  const providers = {};
  for (const definition of providerDefinitions) {
    const providerConfig = config[definition.id] && typeof config[definition.id] === "object" ? config[definition.id] : {};
    providers[definition.id] = normalizeProviderRecord(definition.id, {
      ...providerConfig,
      enabled: definition.id === config.provider || Boolean(providerConfig.apiKey || providerConfig.baseUrl || providerConfig.model),
      apiKey: providerConfig.apiKey || providerConfig.api_key || "",
      baseUrl: providerConfig.baseUrl || providerConfig.base_url || definition.baseUrl || "",
      model: providerConfig.model || definition.model || "",
      region: providerConfig.region || "",
      profile: providerConfig.profile || "",
    });
  }
  return normalizeProviderSettings({
    defaultProvider: normalizedProviderId(config.provider),
    providers,
  });
}

async function readProviderSettings({ includeSecrets = false } = {}) {
  let settings = null;
  if (existsSync(providerSettingsPath)) {
    try {
      settings = normalizeProviderSettings(JSON.parse(await readFile(providerSettingsPath, "utf8")));
    } catch {
      settings = normalizeProviderSettings();
    }
  } else if (existsSync(userConfigPath)) {
    try {
      settings = providerSettingsFromAutohandConfig(JSON.parse(await readFile(userConfigPath, "utf8")));
    } catch {
      settings = normalizeProviderSettings();
    }
    await writeProviderSettings(settings);
  } else {
    settings = normalizeProviderSettings();
    await writeProviderSettings(settings);
  }

  return includeSecrets ? settings : publicProviderSettings(settings);
}

async function writeProviderSettings(settings) {
  const normalized = normalizeProviderSettings({ ...settings, updatedAt: new Date().toISOString() });
  await mkdir(appStateDir, { recursive: true });
  await writeSecretFile(providerSettingsPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

function publicProviderSettings(settings) {
  const normalized = normalizeProviderSettings(settings);
  const providers = {};
  for (const [providerId, provider] of Object.entries(normalized.providers)) {
    const definition = providerDefinitionMap.get(providerId);
    const account = definition?.auth === "account" ? readRuntimeAccount() : null;
    providers[providerId] = {
      ...provider,
      apiKey: "",
      apiKeyConfigured: Boolean(provider.apiKey),
      requiresApiKey: definition?.requiresApiKey === true,
      auth: definition?.auth || "api-key",
      label: definition?.label || providerId,
      kind: definition?.kind || "cloud",
      ...(definition?.auth === "account"
        ? {
            accountReady: autohandAiAccountReady(),
            accountEmail: account?.email || "",
            models: autohandAiModels(),
            managedBaseUrl: AUTOHAND_AI_DEFAULT_BASE_URL,
          }
        : {}),
    };
  }
  return {
    ...normalized,
    definitions: providerDefinitions,
    providers,
  };
}

async function saveProviderSettingsPatch(input = {}) {
  const current = await readProviderSettings({ includeSecrets: true });
  const next = normalizeProviderSettings(input, current);
  return publicProviderSettings(await writeProviderSettings(next));
}

function autohandAiAccountReady() {
  return autohandAuthUsable(readAutohandAuth(userConfigPath));
}

function autohandAiModels() {
  try {
    const catalog = JSON.parse(readFileSync(join(autohandHomeDir, "model-catalog", "models.json"), "utf8"));
    const entries = catalog && typeof catalog.autohandai === "object" ? Object.values(catalog.autohandai) : [];
    const models = entries
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => ({
        id: entry.id,
        label: entry.name || entry.id,
        reasoning: entry.reasoning === true,
        contextWindow: Number(entry.contextWindow) || 0,
      }));
    if (models.length) {
      // Keep the product default first so selects open on it.
      return models.sort((a, b) => (a.id === "auto" ? -1 : b.id === "auto" ? 1 : 0));
    }
  } catch {
    // Catalog missing or unreadable: fall back to the known cloud models.
  }
  return AUTOHAND_AI_FALLBACK_MODELS;
}

function providerCredentialReady(provider) {
  const definition = providerDefinitionMap.get(provider?.id);
  if (!definition) return false;
  if (definition.auth === "account") return Boolean(provider.apiKey) || autohandAiAccountReady();
  return !definition.requiresApiKey || Boolean(provider.apiKey);
}

function providerConfigured(provider) {
  if (!provider?.enabled) return false;
  const definition = providerDefinitionMap.get(provider.id);
  if (!definition) return false;
  if (!providerCredentialReady(provider)) return false;
  if (!provider.model) return false;
  return true;
}

async function testProviderSettings(input = {}) {
  const current = await readProviderSettings({ includeSecrets: true });
  const settings =
    input && typeof input.providerSettings === "object"
      ? normalizeProviderSettings(input.providerSettings, current)
      : current;
  const providerId = normalizedProviderId(input.provider || settings.defaultProvider);
  const provider = settings.providers[providerId];
  if (!provider?.enabled) {
    throw new Error(`${providerDefinitionMap.get(providerId)?.label || providerId} is not enabled.`);
  }
  if (!providerConfigured(provider)) {
    const definition = providerDefinitionMap.get(providerId);
    const missing = [
      definition?.auth === "account" && !providerCredentialReady(provider) ? "a signed-in Autohand account (autohand login) or an API key" : "",
      definition?.auth !== "account" && definition?.requiresApiKey && !provider.apiKey ? "API key" : "",
      !provider.model ? "default model" : "",
    ].filter(Boolean);
    throw new Error(`${definition?.label || providerId} is missing ${missing.join(" and ") || "required fields"}.`);
  }
  if (providerId === "autohandai") {
    return testAutohandAiConnection(provider);
  }
  return {
    provider: providerId,
    model: provider.model,
    status: "configured",
    message: `${providerDefinitionMap.get(providerId)?.label || providerId} is configured for new runs.`,
  };
}

// A real round trip to the inference gateway with the credential the CLI
// would use, so "Test connection" proves the account token or key works.
async function testAutohandAiConnection(provider) {
  const auth = readAutohandAuth(userConfigPath);
  const token = provider.apiKey || (autohandAuthUsable(auth) ? auth.token : "");
  const baseUrl = String(provider.baseUrl || AUTOHAND_AI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        provider.apiKey
          ? "Autohand AI rejected the API key."
          : "Autohand AI rejected the account token. Run `autohand login` again."
      );
    }
    if (!response.ok) {
      throw new Error(`Autohand AI responded ${response.status} from ${baseUrl}.`);
    }
    let served = 0;
    try {
      const body = await response.json();
      served = Array.isArray(body?.data) ? body.data.length : Array.isArray(body) ? body.length : 0;
    } catch {
      // A reachable gateway with a non-JSON body still proves connectivity.
    }
    return {
      provider: "autohandai",
      model: provider.model,
      status: "connected",
      message: `Autohand AI reachable as ${provider.apiKey ? "API key" : readRuntimeAccount().email || "your account"}${served ? ` (${served} models)` : ""}; ${provider.model} is the default model.`,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Autohand AI did not answer within 10 s (${baseUrl}).`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeModelAssignment(assignment) {
  const source = assignment && typeof assignment === "object" ? assignment : {};
  const mode = source.mode === "override" ? "override" : "inherit";
  const provider = normalizedProviderId(source.provider);
  const model = String(source.model || "").trim();
  return mode === "override" ? { mode, provider, model } : { mode: "inherit" };
}

function modelAssignmentFromAgent(agent) {
  if (agent?.modelAssignment && typeof agent.modelAssignment === "object") {
    return normalizeModelAssignment(agent.modelAssignment);
  }
  const permissions = normalizeAgentPermissions(agent);
  if (permissions.modelSecurityEnabled && permissions.modelSecurity.model) {
    return {
      mode: "override",
      provider: permissions.modelSecurity.provider,
      model: permissions.modelSecurity.model,
    };
  }
  return { mode: "inherit" };
}

async function resolveProviderForAgent(agent) {
  const settings = await readProviderSettings({ includeSecrets: true });
  const assignment = modelAssignmentFromAgent(agent);
  const providerId = assignment.mode === "override" ? assignment.provider : settings.defaultProvider;
  const provider = settings.providers[providerId];
  const definition = providerDefinitionMap.get(providerId);

  if (!provider || !definition) {
    throw new Error(`Provider ${providerId} is not available in Settings.`);
  }
  if (!provider.enabled) {
    throw new Error(`${definition.label} is assigned to this agent, but it is not enabled in Settings.`);
  }
  if (!providerCredentialReady(provider)) {
    throw new Error(
      definition.auth === "account"
        ? `${definition.label} needs a signed-in Autohand account (run \`autohand login\`) or an API key in Settings.`
        : `${definition.label} is assigned to this agent, but its API key is missing in Settings.`
    );
  }

  const model = assignment.mode === "override" ? assignment.model : provider.model;
  if (!model) {
    throw new Error(`${definition.label} needs a default model before this agent can run.`);
  }

  return {
    assignment,
    provider: providerId,
    label: definition.label,
    model,
    baseUrl: provider.baseUrl || "",
    apiKey: provider.apiKey || "",
    region: provider.region || "",
    profile: provider.profile || "",
    source: assignment.mode === "override" ? "agent" : "workspace",
  };
}

function providerConfigForResolved(resolvedProvider) {
  const config = {};
  if (resolvedProvider.provider === "autohandai") {
    // Mirrors the CLI's AutohandAISettings: cloud plan, account auth unless an
    // API key is supplied; the account token itself is the synced `auth` block.
    config.plan = "cloud";
    config.authMode = resolvedProvider.apiKey ? "api-key" : "account";
  }
  if (resolvedProvider.apiKey) config.apiKey = resolvedProvider.apiKey;
  if (resolvedProvider.baseUrl) config.baseUrl = resolvedProvider.baseUrl;
  if (resolvedProvider.model) config.model = resolvedProvider.model;
  if (resolvedProvider.region) config.region = resolvedProvider.region;
  if (resolvedProvider.profile) config.profile = resolvedProvider.profile;
  return config;
}

function publicResolvedProvider(resolvedProvider) {
  if (!resolvedProvider) return null;
  return {
    provider: resolvedProvider.provider,
    label: resolvedProvider.label,
    model: resolvedProvider.model,
    baseUrl: resolvedProvider.baseUrl,
    source: resolvedProvider.source,
  };
}

const permissionModes = new Set(["interactive", "restricted", "unrestricted", "external"]);
const toolPolicyModes = new Set(["allow", "ask", "block"]);
const fileGuardTargetTools = [
  "read_file",
  "write_file",
  "append_file",
  "apply_patch",
  "search_replace",
  "notebook_edit",
  "delete_path",
];
const modelSecurityProviders = new Set([
  "autohandai",
  "openrouter",
  "openai",
  "llmgateway",
  "ollama",
  "bedrock",
  "deepseek",
  "zai",
  "nvidia",
  "cerebras",
]);

function normalizeProjectLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return projectLimitUpperBound;
  return Math.min(projectLimitUpperBound, Math.max(1, Math.floor(parsed)));
}

function normalizeHandoffRetryMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["manual", "manual-retry", "user", "user-driven"].includes(mode)) return "manual";
  if (["disabled", "disable", "off", "none", "never"].includes(mode)) return "disabled";
  return "checkpoint";
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeAgentProjects(agent, fallbackWorkspace = "", includeFallback = false) {
  const sourceProjects = Array.isArray(agent?.projects) ? agent.projects : [];
  const candidates = includeFallback && fallbackWorkspace ? [{ path: fallbackWorkspace }, ...sourceProjects] : sourceProjects;
  const source = candidates.length ? candidates : fallbackWorkspace ? [{ path: fallbackWorkspace }] : [];
  const seen = new Set();
  const projects = [];

  for (const item of source) {
    const rawPath = typeof item === "string" ? item : item?.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) continue;

    const resolvedPath = normalizeSquadWorkspacePath(resolve(rawPath.replace(/\/+$/, "") || rawPath));
    if (seen.has(resolvedPath) || !isRunnableWorkspace(resolvedPath)) continue;
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) continue;

    seen.add(resolvedPath);
    projects.push({
      id: String(item?.id || `project_${Buffer.from(resolvedPath).toString("base64url").slice(0, 24)}`),
      name: String(item?.name || basename(resolvedPath)),
      label: String(item?.label || relative(homeDir, resolvedPath) || basename(resolvedPath)),
      path: resolvedPath,
      kind: String(item?.kind || (existsSync(join(resolvedPath, ".git")) ? "git repo" : "project")),
      addedAt: String(item?.addedAt || ""),
    });

    if (projects.length >= maxProjectsPerMember) break;
  }

  return projects;
}

function normalizeAgentPermissions(agent) {
  const permissions = agent?.permissions && typeof agent.permissions === "object" ? agent.permissions : {};
  const builtInPolicies = permissions.builtInPolicies && typeof permissions.builtInPolicies === "object"
    ? Object.fromEntries(
        Object.entries(permissions.builtInPolicies)
          .filter(([tool, mode]) => tool && toolPolicyModes.has(mode))
          .map(([tool, mode]) => [tool, mode])
      )
    : {};
  // The ladder's capability modes (shell.read, web.fetch, mcp.connectors, ...)
  // are kept so an agent-less call still knows whether connectors are allowed.
  const modes = permissions.modes && typeof permissions.modes === "object"
    ? Object.fromEntries(Object.entries(permissions.modes).filter(([id, mode]) => id && toolPolicyModes.has(mode)))
    : {};
  const modelSecurity = permissions.modelSecurity && typeof permissions.modelSecurity === "object" ? permissions.modelSecurity : {};
  const provider = modelSecurityProviders.has(modelSecurity.provider) ? modelSecurity.provider : "autohandai";
  const model = String(modelSecurity.model || "").trim();

  return {
    permissionMode: permissionModes.has(permissions.permissionMode) ? permissions.permissionMode : "interactive",
    rememberSession: permissions.rememberSession !== false,
    builtInToolPolicyEnabled: permissions.builtInToolPolicyEnabled !== false,
    fileGuardEnabled: permissions.fileGuardEnabled !== false,
    modelSecurityEnabled: permissions.modelSecurityEnabled === true,
    builtInPolicies,
    modes,
    sensitivePaths: uniqueStrings(Array.isArray(permissions.sensitivePaths) ? permissions.sensitivePaths : []),
    allPathsAllowed: permissions.allPathsAllowed === true,
    allUrlsAllowed: permissions.allUrlsAllowed === true,
    modelSecurity: {
      provider,
      model,
      thinkingLevel: ["none", "normal", "extended"].includes(modelSecurity.thinkingLevel)
        ? modelSecurity.thinkingLevel
        : "normal",
      toolChoice: ["auto", "required", "none"].includes(modelSecurity.toolChoice)
        ? modelSecurity.toolChoice
        : "auto",
      requireNativeToolCalling: modelSecurity.requireNativeToolCalling !== false,
      lockModelSelector: modelSecurity.lockModelSelector === true,
      requireConfiguredSearchProvider: modelSecurity.requireConfiguredSearchProvider !== false,
    },
  };
}

function expandPathPattern(pathPattern) {
  const value = String(pathPattern || "").trim();
  if (!value) return [];
  if (value.startsWith("~/")) {
    return [value, join(homeDir, value.slice(2))];
  }
  return [value];
}

function permissionSettingsFromAgent(agent) {
  const permissions = normalizeAgentPermissions(agent);
  const settings = {
    mode: permissions.permissionMode,
    rememberSession: permissions.rememberSession,
    allPathsAllowed: permissions.allPathsAllowed,
    allUrlsAllowed: permissions.allUrlsAllowed,
  };

  if (permissions.builtInToolPolicyEnabled) {
    const entries = Object.entries(permissions.builtInPolicies);
    settings.allowPatterns = entries
      .filter(([, mode]) => mode === "allow")
      .map(([kind]) => ({ kind }));
    settings.availableTools = entries
      .filter(([, mode]) => mode !== "block")
      .map(([kind]) => ({ kind }));
    settings.excludedTools = entries
      .filter(([, mode]) => mode === "block")
      .map(([kind]) => ({ kind }));
    settings.rules = entries
      .filter(([, mode]) => mode === "ask")
      .map(([tool]) => ({ tool, action: "prompt" }));
  }

  if (permissions.fileGuardEnabled && permissions.sensitivePaths.length) {
    const pathPatterns = uniqueStrings(permissions.sensitivePaths.flatMap(expandPathPattern));
    settings.denyList = pathPatterns.flatMap((pathPattern) =>
      fileGuardTargetTools.map((tool) => `${tool}:${pathPattern}`)
    );
  }

  return settings;
}

function modelSecurityConfigFromAgent(agent, config) {
  const permissions = normalizeAgentPermissions(agent);
  if (!permissions.modelSecurityEnabled) {
    return {};
  }
  const { provider, model } = permissions.modelSecurity;
  const providerConfig = config[provider] && typeof config[provider] === "object" ? config[provider] : {};
  return {
    provider,
    [provider]: {
      ...providerConfig,
      ...(model ? { model } : {}),
    },
  };
}

const profileFileDefinitions = [
  {
    section: "identity",
    fileName: "IDENTITY.md",
    title: "Identity",
    meaning: "role, responsibilities, ownership, and expected evidence",
  },
  {
    section: "persona",
    fileName: "PERSONALITY.md",
    aliases: ["PERSONA.md"],
    title: "Personality",
    meaning: "tone, collaboration style, behavioral defaults, and escalation rules",
  },
  {
    section: "bible",
    fileName: "BIBLE.md",
    title: "Bible",
    meaning: "workflow rules, verification expectations, tools, and boundaries",
  },
  {
    section: "brain-card",
    fileName: "BRAIN_CARD.md",
    title: "Brain Card",
    meaning: "structured purpose, workflow, tools, escalation, done standards, review style, and memory policy",
  },
  {
    section: "memory",
    fileName: "MEMORY.md",
    title: "Memory",
    meaning: "durable agent-specific context, saved learnings, and project preferences",
  },
];

const brainCardFieldDefinitions = [
  { id: "purpose", label: "Purpose" },
  { id: "defaultWorkflow", label: "Default workflow" },
  { id: "allowedTools", label: "Allowed tools" },
  { id: "escalationRules", label: "Escalation rules" },
  { id: "definitionOfDone", label: "Definition of done" },
  { id: "reviewStyle", label: "Review style" },
  { id: "memoryPolicy", label: "Memory policy" },
];

function genericBrainCardForAgent(agent, skillInstall) {
  const role = agent.role || "Software engineering agent";
  const skills = Array.isArray(skillInstall?.requested)
    ? skillInstall.requested
    : Array.isArray(agent.skills)
      ? agent.skills
      : [];
  return {
    purpose: agent.description || `Operate as ${role} for the selected local workspace.`,
    defaultWorkflow: [
      "1. Inspect the active workspace and task context before acting.",
      "2. Clarify assumptions when role scope or ownership is ambiguous.",
      "3. Work in small scoped increments using the role's standards.",
      "4. Validate with the strongest local evidence available.",
      "5. Report outcome, evidence, and remaining risk clearly.",
    ].join("\n"),
    allowedTools: [
      "- Autohand CLI inside this squad member's isolated home.",
      "- Local read/search/edit/build/test tools allowed by the current permission policy.",
      skills.length ? skills.map((skill) => `- ${skill}`).join("\n") : "- Installed profile skills when they match the task.",
    ].join("\n"),
    escalationRules: [
      "- Ask before destructive changes, secret access, or crossing repository boundaries.",
      "- Hand off when another squad member has clearer ownership.",
      "- Stop and surface blockers when credentials, runtime services, or product decisions are missing.",
    ].join("\n"),
    definitionOfDone: [
      "- The requested behavior or artifact is complete.",
      "- Role-specific risks have been checked.",
      "- Validation evidence is captured.",
      "- Remaining uncertainty is named.",
    ].join("\n"),
    reviewStyle: agent.instructions || `Review work through the standards expected of a ${role}.`,
    memoryPolicy:
      "Propose durable memory only for stable role preferences, project facts, repeated decisions, or verified constraints. Keep secrets, temporary logs, speculative findings, and one-off session details out of durable memory unless the app promotes them through the memory flow.",
    whyThisAgent: `Choose this squad member when the task needs ${role} judgment and its configured skills.`,
  };
}

function normalizeBrainCard(agent, skillInstall) {
  const source = agent?.brainCard && typeof agent.brainCard === "object" ? agent.brainCard : {};
  const fallback = genericBrainCardForAgent(agent || {}, skillInstall);
  const normalized = {};
  for (const field of brainCardFieldDefinitions) {
    normalized[field.id] = String(source[field.id] || fallback[field.id] || "").trim();
  }
  normalized.whyThisAgent = String(source.whyThisAgent || fallback.whyThisAgent || "").trim();
  return normalized;
}

function brainCardMarkdown(agent, skillInstall) {
  const brainCard = normalizeBrainCard(agent, skillInstall);
  const lines = [
    "# Brain Card",
    "",
    `Agent: ${agent.name || "Squad member"}`,
    `Role: ${agent.role || "Software engineering agent"}`,
  ];
  for (const field of brainCardFieldDefinitions) {
    lines.push("", `## ${field.label}`, "", brainCard[field.id] || "Not configured.");
  }
  lines.push("", "## Why this agent?", "", brainCard.whyThisAgent || "Not configured.");
  return lines.join("\n");
}

function cleanProfileMarkdownFileName(definition, input) {
  const fallback = definition.fileName;
  const baseName = basename(String(input || "").trim());
  if (!baseName || !baseName.toLowerCase().endsWith(".md")) return fallback;
  const lowerName = baseName.toLowerCase();
  const alias = definition.aliases?.find((item) => item.toLowerCase() === lowerName);
  if (alias) return alias;
  return lowerName === fallback.toLowerCase() ? fallback : fallback;
}

function defaultProfileFileContent(agent, definition, workspace, skillInstall) {
  const name = agent.name || "Squad member";
  const role = agent.role || "Software engineering agent";
  const skills = Array.isArray(skillInstall.requested) ? skillInstall.requested : [];
  const projects = normalizeAgentProjects(agent, workspace, true);

  if (definition.section === "identity") {
    return [
      "# Identity",
      `Name: ${name}`,
      `Role: ${role}`,
      agent.description
        ? `Responsibilities:\n${agent.description}`
        : "Responsibilities:\nWork as the configured Autohand Squad member for the selected local workspace.",
      `Default workspace: ${workspace}`,
      projects.length ? `Associated projects:\n${projects.map((project) => `- ${project.label}: ${project.path}`).join("\n")}` : "",
    ].join("\n\n");
  }

  if (definition.section === "persona") {
    return [
      "# Personality",
      agent.instructions || `Act as ${role}. Keep work scoped, ask when role boundaries are unclear, and report evidence clearly.`,
      "Collaboration defaults:\n- Match the role selected in Autohand Squad.\n- Keep local work isolated to this squad member's Autohand home.\n- Use concise, evidence-backed status updates.",
    ].join("\n\n");
  }

  if (definition.section === "bible") {
    return [
      "# Bible",
      "Workflow:\n- Inspect the selected workspace before acting.\n- Keep changes scoped to the user's request.\n- Use installed profile skills when they match the task.\n- Report validation evidence after running local Autohand work.",
      skills.length ? `Profile skills:\n${skills.map((skill) => `- ${skill}`).join("\n")}` : "Profile skills:\n- No skills selected yet.",
    ].join("\n\n");
  }

  if (definition.section === "brain-card") {
    return brainCardMarkdown(agent, skillInstall);
  }

  const memoryItems = Array.isArray(agent.memory) ? agent.memory : [];
  return [
    "# Memory",
    "Durable context for this squad member:",
    memoryItems.length ? memoryItems.map((item) => `- ${item}`).join("\n") : "- Created from Autohand Squad.",
    `Skill source: ${agent.skillSource || skilledBaseUrl}`,
  ].join("\n\n");
}

function normalizeProfileFiles(agent, workspace, skillInstall) {
  const providedFiles = Array.isArray(agent.profileFiles) ? agent.profileFiles : [];
  const providedBySection = new Map();
  for (const file of providedFiles) {
    const section = String(file?.section || "").trim().toLowerCase();
    const content = String(file?.content || "").trim();
    if (!section || !content || content.length > 512 * 1024) continue;
    providedBySection.set(section, file);
  }

  return profileFileDefinitions.map((definition) => {
    if (definition.section === "brain-card") {
      return {
        ...definition,
        fileName: definition.fileName,
        originalFileName: "",
        content: defaultProfileFileContent(agent, definition, workspace, skillInstall),
        source: "generated",
      };
    }
    const provided = providedBySection.get(definition.section);
    const originalFileName = String(provided?.originalFileName || provided?.fileName || "").trim();
    const fileName = cleanProfileMarkdownFileName(definition, originalFileName);
    return {
      ...definition,
      fileName,
      originalFileName,
      content: String(provided?.content || "").trim() || defaultProfileFileContent(agent, definition, workspace, skillInstall),
      source: provided?.source === "upload" ? "upload" : provided?.source === "manual" ? "manual" : "generated",
    };
  });
}

function buildAgentProfileIndex(agent, files, profileDir, displayProfileDir) {
  const name = agent.name || "Squad member";
  const role = agent.role || "Software engineering agent";
  const personaFile = files.find((file) => file.section === "persona");
  const lines = [
    "# AGENTS.md",
    "",
    `This is the profile map for ${name} (${role}).`,
    "It points to this squad member's saved profile Markdown files without embedding their full contents in the system prompt.",
    "Read the specific profile file when the user's request needs that kind of role context.",
    "",
    "## Profile Files",
  ];

  for (const file of files) {
    lines.push(`- \`${join(profileDir, file.fileName)}\` (${displayProfileDir}/${file.fileName}): ${file.meaning}.`);
  }

  lines.push("- `PERSONA.md` is accepted as an alias for `PERSONALITY.md` when present.");

  lines.push(
    "",
    "## Usage",
    "- Use `IDENTITY.md` for role scope, ownership, and responsibility questions.",
    "- Use `PERSONALITY.md` or `PERSONA.md` for tone, collaboration, and behavioral defaults.",
    "- Use `BIBLE.md` for workflow, verification, and operating rules.",
    "- Use `BRAIN_CARD.md` for the structured operating contract: purpose, workflow, tools, escalation, done standards, review style, and memory policy.",
    "- Use `MEMORY.md` for durable context and saved learnings.",
    "- Do not load every profile file by default; choose the smallest relevant file for the task."
  );

  return lines.join("\n");
}

function planAgentProfileDocs(agent, agentHome, agentId, workspace, skillInstall) {
  const profileDir = join(agentHome, "profile");
  const displayProfileDir = `.autohand/agents/${agentId}/profile`;
  const files = normalizeProfileFiles(agent, workspace, skillInstall);
  const agentsPath = join(agentHome, "AGENTS.md");
  return {
    files,
    index: `${buildAgentProfileIndex(agent, files, profileDir, displayProfileDir)}\n`,
    profileDocs: {
      path: profileDir,
      displayPath: displayProfileDir,
      agentsPath,
      displayAgentsPath: `.autohand/agents/${agentId}/AGENTS.md`,
      files: files.map((file) => ({
        section: file.section,
        title: file.title,
        fileName: file.fileName,
        originalFileName: file.originalFileName,
        source: file.source,
        path: join(profileDir, file.fileName),
        displayPath: `${displayProfileDir}/${file.fileName}`,
        meaning: file.meaning,
      })),
    },
  };
}

async function writeAgentProfileDocs(plan) {
  await mkdir(plan.profileDocs.path, { recursive: true });
  for (const file of plan.files) {
    await writeFile(join(plan.profileDocs.path, file.fileName), `${file.content.trim()}\n`, "utf8");
  }
  await writeFile(plan.profileDocs.agentsPath, plan.index, "utf8");
}

async function readAgentRuntimeConfig(configPath, workspace) {
  try {
    const savedConfig = await readPersistentJson(configPath, undefined);
    const config = savedConfig === undefined
      ? await readPersistentJson(userConfigPath, defaultAgentConfig(workspace))
      : savedConfig;
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Expected a JSON object.");
    return config;
  } catch (error) {
    const reason = error instanceof SyntaxError ? "The file is not valid JSON." : error.code ? `Filesystem error: ${error.code}.` : error.message;
    throw new Error(`Could not read the member runtime config. Restore a valid config.json, then retry. ${reason}`);
  }
}

// Read the persisted Autohand auth block from a config file, if present.
function readAutohandAuth(configPath) {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return config && typeof config.auth === "object" && config.auth ? config.auth : null;
  } catch {
    return null;
  }
}

// A token is usable when it exists and is not locally expired. Mirrors the
// Autohand CLI's own `isTokenExpiredLocally` so we agree with the binary on when
// it would otherwise drop into a blocking interactive re-login.
function autohandAuthUsable(auth) {
  if (!auth || !auth.token) return false;
  if (!auth.expiresAt) return true;
  const expiresAt = Date.parse(auth.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
}

// Throw a clear, actionable error instead of spawning a CLI that would block on
// interactive sign-in. Call before any non-TTY autohand spawn (rpc/CLI run/chat).
function assertAutohandAuth(agentRuntime) {
  if (!agentRuntime?.authReady) {
    throw new AutohandAuthError(
      "Autohand sign-in required or expired. Run `autohand login` in your terminal, then retry."
    );
  }
}

// Agents the app runs for itself rather than members of the squad: they answer
// one question with text, never hold a conversation, and never run a tool.
const utilityAgentIds = new Set(["squad-designer"]);

function isUtilityAgent(agentId) {
  return utilityAgentIds.has(String(agentId || ""));
}

const agentRuntimeWrites = new Map();
async function withSavedMember(payload) {
  const id = sanitizeAgentId(payload.agent?.id || payload.agentId);
  const saved = await readPersistentJson(join(isolatedAgentsDir, id, "profile.json"), null);
  if (saved && (typeof saved !== "object" || Array.isArray(saved))) throw new Error("The saved member profile is invalid. Restore it before retrying.");
  const registered = await agentChannelActions.memberAccess(id);
  const incoming = { ...saved, ...(payload.agent || {}), id };
  const agent = mergeMemberProfile(incoming, registered?.agent);
  if (!saved && !registered?.agent) return payload;
  // An older window's prose can contradict the profile it is now loading.
  // The runtime builds the current contract from the persisted member below.
  return { ...payload, ...(agent !== incoming ? { profile: "" } : {}), agent, _memberDescriptionProvided: Boolean(payload.agent && typeof payload.agent === "object" && !Array.isArray(payload.agent)) };
}

async function ensureAgentRuntime(input, workspace) {
  const id = sanitizeAgentId(input.agent?.id || input.agentId);
  const pending = (agentRuntimeWrites.get(id) || Promise.resolve()).catch(() => {}).then(() => ensureAgentRuntimeInner(input, workspace));
  agentRuntimeWrites.set(id, pending);
  try { return await pending; }
  finally { if (agentRuntimeWrites.get(id) === pending) agentRuntimeWrites.delete(id); }
}

async function ensureAgentRuntimeInner(input, workspace) {
  const describesAgent = input._memberDescriptionProvided !== false && Boolean(input.agent && typeof input.agent === "object" && !Array.isArray(input.agent));
  const agentId = sanitizeAgentId(input.agent?.id || input.agentId);
  const agentHome = join(isolatedAgentsDir, agentId);
  const profilePath = join(agentHome, "profile.json");
  const saved = await readPersistentJson(profilePath, {});
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("The saved member profile is invalid. Restore it before retrying.");
  // Older profiles stored file metadata rather than their authored content.
  // Hydrate only this member's own profile directory before any regeneration.
  const savedFiles = Array.isArray(saved.profileFiles) ? saved.profileFiles : [];
  if (!savedFiles.length && Array.isArray(saved.profileDocs?.files)) {
    for (const file of saved.profileDocs.files) {
      if (!file?.fileName || basename(file.fileName) !== file.fileName) continue;
      try { savedFiles.push({ ...file, content: await readFile(join(agentHome, "profile", file.fileName), "utf8") }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const agent = memberProfileDefaults({ ...saved, ...(savedFiles.length ? { profileFiles: savedFiles } : {}), ...(input.agent && typeof input.agent === "object" && !Array.isArray(input.agent) ? input.agent : {}), id: agentId });
  const configPath = join(agentHome, "config.json");
  const displayConfigPath = `.autohand/agents/${agentId}/config.json`;
  const displayProfileDir = `.autohand/agents/${agentId}/profile`;
  // Refuse damaged configuration before installing skills or rewriting any
  // authored profile documents. Missing config inherits the user's defaults.
  const config = await readAgentRuntimeConfig(configPath, workspace);
  await mkdir(agentHome, { recursive: true });
  await Promise.all([
    mkdir(join(agentHome, "sessions"), { recursive: true }),
    mkdir(join(agentHome, "memory"), { recursive: true }),
    mkdir(join(agentHome, "projects"), { recursive: true }),
    mkdir(join(agentHome, "skills"), { recursive: true }),
  ]);

  const skillInstall = await installAgentSkills(agent, agentHome, agentId);
  const projects = normalizeAgentProjects(agent, workspace, true);
  const brainCard = normalizeBrainCard(agent, skillInstall);
  const profilePlan = planAgentProfileDocs(agent, agentHome, agentId, workspace, skillInstall);
  const profileDocs = profilePlan.profileDocs;
  const harnessAssignment = harnessAssignmentFromAgent(agent);
  const externalHarness = isExternalHarness(harnessAssignment);
  // Vendor CLIs authenticate and choose models in their own harness. Creating
  // Squad's profile/workspace must not require an unrelated Autohand login.
  const resolvedProvider = externalHarness ? {
    provider: harnessAssignment.id, label: getAdapter(harnessAssignment).label,
    model: String(input.model || harnessAssignment.model || ""), baseUrl: "", source: "harness",
  } : await resolveProviderForAgent(agent);

  // Enabled connectors reach a member only when its mcp.connectors policy
  // is "allow" (ADR-0107); the person's own MCP entries are always kept.
  const connectorSpecs = !isUtilityAgent(agentId) && connectorsAllowed(agent) ? await connectors.enabledSpecs({ firecrawlBaseUrl }) : [];
  try {
    const permissionSettings = permissionSettingsFromAgent(agent);
    const normalizedPermissions = normalizeAgentPermissions(agent);
    const providerSpecificConfig = providerConfigForResolved(resolvedProvider);
    // Keep each member's auth in sync with the user's login. The config is copied
    // from the user's config only on first creation, so a later `autohand login`
    // never reached existing members — their frozen token would expire and the
    // CLI (spawned with --config <agent-config>) would block on an interactive
    // re-login over a non-TTY pipe, stalling the SDK stream. Adopt the user's
    // current token whenever it is usable. If the user has logged out, remove
    // the member's copied token as well so an old isolated profile cannot keep
    // authenticating after the global session is cleared.
    const userAuth = readAutohandAuth(userConfigPath);
    const syncedAuth = autohandAuthUsable(userAuth) ? userAuth : null;
    const nextConfig = {
      ...config,
      ...(syncedAuth ? { auth: syncedAuth } : {}),
      // The user's MCP servers are copied into every agent home, and starting
      // them is most of a cold start: a Docker image to run, an editor plugin
      // that has to be open. A utility agent cannot use a tool, so it was
      // paying that cost for nothing — enough of it to blow the member
      // designer's own twenty-second budget and hand back a generic member
      // every time. Measured on this machine: 20s+ and a timeout with the
      // servers, 15.6s and a real answer without them.
      mcp: isUtilityAgent(agentId)
        ? { ...(config.mcp && typeof config.mcp === "object" ? config.mcp : {}), servers: [] }
        : mergeAutohandMcp(config.mcp, autohandServersFor(connectorSpecs)),
      ...(!externalHarness ? { provider: resolvedProvider.provider,
      [resolvedProvider.provider]: {
        ...(config[resolvedProvider.provider] && typeof config[resolvedProvider.provider] === "object"
          ? config[resolvedProvider.provider]
          : {}),
        ...providerSpecificConfig,
      } } : {}),
      workspace: {
        ...(config.workspace && typeof config.workspace === "object" ? config.workspace : {}),
        defaultRoot: workspace,
        projects,
      },
      agent: {
        ...(config.agent && typeof config.agent === "object" ? config.agent : {}),
        idleLogoutEnabled: false,
        projectLimit: maxProjectsPerMember,
        projects,
        profileSkills: skillInstall.requested,
        skillsRegistry: skilledBaseUrl,
        skillsPath: skillInstall.displayPath,
        profilePath: profileDocs.displayPath,
        profileMap: profileDocs.displayAgentsPath,
        brainCard,
        permissionsUi: normalizedPermissions,
        modelSecurity: normalizedPermissions.modelSecurity,
        modelAssignment: modelAssignmentFromAgent(agent),
        effectiveModel: publicResolvedProvider(resolvedProvider),
      },
      // Only rewrite the permission block when the caller actually described
      // the member. A request that carries no agent knows nothing about its
      // permissions, and `permissionSettingsFromAgent({})` returns empty tool
      // lists, so an agent-less call used to erase every allow, ask and block
      // the person had set. /api/chat/warm was exactly such a call, and it
      // fires once per member every time a chat opens, which is why a tool
      // moved from blocked to ask went back to blocked "the moment it tries
      // to use it". Absence of information preserves; it does not delete.
      ...(describesAgent
        ? {
            permissions: {
              ...(config.permissions && typeof config.permissions === "object" ? config.permissions : {}),
              ...permissionSettings,
            },
          }
        : {}),
    };
    if (!syncedAuth) delete nextConfig.auth;
    await writePersistentJson(configPath, nextConfig);
  } catch (error) {
    throw new Error(`Could not save the member runtime config. Check its folder permissions, then retry. ${error.message}`);
  }

  await writeAgentProfileDocs(profilePlan);
  await writePersistentJson(
    profilePath,
      {
        id: agentId,
        staffId: agent.staffId || "",
        name: agent.name || "Squad member",
        profileRevision: memberProfileRevision(agent),
        role: agent.role || "",
        employeeType: agent.employeeType || "",
        description: agent.description || "",
        instructions: agent.instructions || "",
        brainCard,
        skills: skillInstall.requested,
        skillSource: skilledBaseUrl,
        skillInstall,
        profileDocs,
        permissions: normalizeAgentPermissions(agent),
        modelAssignment: modelAssignmentFromAgent(agent),
        effectiveModel: publicResolvedProvider(resolvedProvider),
        harness: harnessAssignmentFromAgent(agent),
        projects,
        profileFiles: agent.profileFiles || [],
        memory: agent.memory || [],
        limits: {
          maxProjectsPerMember,
        },
        workspace,
        updatedAt: new Date().toISOString(),
      }
  );

  // Reflects the auth that the spawned CLI will actually load (the agent config
  // we just synced), falling back to the user config. Drives the pre-flight
  // sign-in check so a stale/missing token fails fast instead of stalling.
  const authReady =
    autohandAuthUsable(readAutohandAuth(configPath)) ||
    autohandAuthUsable(readAutohandAuth(userConfigPath));

  return prepareTeamWork(await prepareVaultWork(await prepareComputerWork({
    agent,
    agentId,
    agentHome,
    configPath,
    profilePath,
    displayConfigPath,
    displayProfileDir,
    workspace,
    skillInstall,
    profileDocs,
    brainCard,
    effectiveModel: publicResolvedProvider(resolvedProvider),
    resolvedProvider,
    authReady,
    harness: harnessAssignmentFromAgent(agent),
    // Launch specs carry connector secrets; keep them out of public summaries.
    connectorServers: connectorSpecs,
  }, input), input), input);
}

function runtimeMemberInstructions(agentRuntime) {
  const agent = agentRuntime.agent || {};
  const persona = agent.profileFiles?.find(file => file.section === "persona")?.content || "";
  // Durable memory travels inline too (ADR-0115): a member in plan mode or on
  // an engine that never opens MEMORY.md still knows what it saved.
  const memory = agent.profileFiles?.find(file => file.section === "memory")?.content || "";
  const brain = agentRuntime.brainCard || {};
  const policies = normalizeAgentPermissions(agent).builtInPolicies;
  return [
    "Autohand Squad runtime member contract",
    `Member: ${agent.name || "Squad member"} (${agentRuntime.agentId})`,
    `Role: ${agent.role || "Software engineering agent"}`,
    agent.description ? `Responsibilities: ${agent.description}` : "",
    agent.instructions ? `Operating instructions: ${String(agent.instructions).slice(0, 4000)}` : "",
    persona ? `Personality:\n${String(persona).slice(0, 5000)}` : "",
    memory.trim() ? `Durable memory (MEMORY.md):\n${String(memory).slice(0, 4000)}` : "",
    ...brainCardFieldDefinitions.map(field => `${field.label}: ${String(brain[field.id] || "").slice(0, 1500)}`),
    `Selected workspace: ${agentRuntime.workspace}`,
    `Profile map: ${agentRuntime.profileDocs?.agentsPath || ""}`,
    "Read only the relevant profile files when you need additional context or durable memory. Keep this member's sessions and memory isolated. Propose stable project facts for user review; never store secrets or transient logs as durable memory.",
    `Installed profile skills: ${(agentRuntime.skillInstall?.installed || []).map(skill => skill.id).join(", ") || "none"}. Use only configured, installed skills relevant to the task.`,
    agentRuntime.skillInstall?.failed?.length ? `Unavailable requested skills: ${agentRuntime.skillInstall.failed.map(skill => skill.id).join(", ")}. Do not claim these skills were loaded.` : "",
    `Blocked tools: ${Object.entries(policies).filter(([, policy]) => policy === "block").map(([tool]) => tool).join(", ") || "none explicitly configured"}.`,
    `Tools requiring approval: ${Object.entries(policies).filter(([, policy]) => policy === "ask").map(([tool]) => tool).join(", ") || "none explicitly configured"}.`,
    "Current tool permissions govern execution even when a role describes a broader capability. Ask before crossing role or project boundaries, and hand off work to an existing teammate when appropriate. Report observed results and remaining blockers; never invent verification.",
  ].filter(Boolean).join("\n");
}

function runtimeProfilePrompt(profile, agentRuntime) {
  return [runtimeMemberInstructions(agentRuntime), profile].filter(Boolean).join("\n\n");
}

// Observation uses a separate, minimal configuration. It must never create
// a member's warm session, install skills, or inherit Computer Use/MCP/hooks.
async function prepareProjectObserverRuntime({ member }) {
  if (observerAccountTransition || !readRuntimeAccount().signedIn) throw new Error("Sign in before observing assigned projects.");
  const cliPath = resolveAutohandBinary();
  if (!cliPath) throw new Error("The selected Autohand CLI is not installed.");
  const selected = await resolveProviderForAgent(member);
  const original = readJsonFileSync(userConfigPath) || {};
  const auth = readAutohandAuth(userConfigPath);
  const agentId = `squad-observer-${sanitizeAgentId(member.id)}`;
  const agentHome = join(isolatedAgentsDir, "observers", sanitizeAgentId(member.id));
  const configPath = join(agentHome, "config.json");
  await mkdir(agentHome, { recursive: true });
  const config = {
    provider: selected.provider,
    [selected.provider]: { ...(original[selected.provider] || {}), ...providerConfigForResolved(selected) },
    ...(autohandAuthUsable(auth) ? { auth } : {}),
    workspace: { defaultRoot: agentHome, projects: [] },
    permissions: { mode: "restricted" },
    mcp: { servers: [] }, hooks: { enabled: false }, memory: { enabled: false },
    agent: { idleLogoutEnabled: false, projects: [], projectLimit: 1 },
  };
  await writeSecretFile(configPath, JSON.stringify(config, null, 2));
  return { cliPath, configPath, model: selected.model, envVars: { ...agentRuntimeEnvVars({ agentId, agentHome, configPath }), AUTOHAND_SQUAD_OBSERVATION: "1" } };
}

// Canvases (ADR-0023): a run or chat may carry `canvasDir`, the folder the
// canvases plug-in materialised a canvas into. Only that folder is accepted.
function canvasDirFor(input) {
  const value = String(input?.canvasDir || "").trim();
  if (!value) return "";
  const allowed = join(squadStateDir, "canvas");
  const resolved = resolve(value);
  if (resolved !== allowed && !resolved.startsWith(`${allowed}/`)) return "";
  return resolved;
}

async function autohandArgs(input) {
  const mode = input.mode || "prompt";
  const workspace = await cleanWorkspace(input.workspace);
  const prompt = String(input.prompt || "").trim();
  let profile = String(input.profile || "").trim().slice(0, 12000);
  const agentRuntime = await ensureAgentRuntime(input, workspace);
  profile = [runtimeProfilePrompt(profile, agentRuntime), computerUseInstructions(agentRuntime), connectorInstructions(agentRuntime.connectorServers), vaultInstructions(agentRuntime), teamInstructionsFor(agentRuntime), recallInstructions(input), workPlanInstructions(input), memberShapingInstructions(input)].filter(Boolean).join("\n\n");
  const permissions = normalizeAgentPermissions(agentRuntime.agent);
  const associatedProjects = normalizeAgentProjects(agentRuntime.agent);
  const args = ["--path", workspace, "--config", agentRuntime.configPath];
  const displayArgs = ["--path", workspace, "--config", "<agent-config>"];

  function pushArg(...values) {
    args.push(...values);
    displayArgs.push(...values);
  }

  if (autohandSupportsFlag("--no-idle-logout")) {
    pushArg("--no-idle-logout");
  }

  const effectiveModel = input.model || agentRuntime.resolvedProvider?.model || (permissions.modelSecurityEnabled ? permissions.modelSecurity.model : "");
  if (effectiveModel) {
    pushArg("--model", effectiveModel);
    // Reasoning level (ADR-0114): only the moa model takes --thinking, and
    // only the levels the CLI documents (none, normal, extended).
    const thinking = normalizeEffort(input.effort || harnessAssignmentFromAgent(agentRuntime.agent).effort);
    if (thinking && ["none", "normal", "extended"].includes(thinking) && String(effectiveModel || "").toLowerCase() === "moa") pushArg("--thinking", thinking);
  }
  if (agentRuntime.profileDocs?.path) {
    args.push("--add-dir", agentRuntime.profileDocs.path);
    displayArgs.push("--add-dir", agentRuntime.profileDocs.displayPath || "<agent-profile-dir>");
  }
  for (const project of associatedProjects) {
    if (project.path === workspace) continue;
    args.push("--add-dir", project.path);
    displayArgs.push("--add-dir", project.label || project.path);
  }
  if (canvasDirFor(input)) {
    args.push("--add-dir", canvasDirFor(input));
    displayArgs.push("--add-dir", "<canvas>");
  }
  if (profile) {
    args.push("--append-sys-prompt", profile);
    displayArgs.push("--append-sys-prompt", "<agent-profile>");
  }
  if (permissions.permissionMode === "unrestricted") {
    pushArg("--unrestricted");
  } else if (permissions.permissionMode === "restricted" || input.policy === "restricted") {
    pushArg("--restricted");
  } else if (input.policy === "yes") {
    pushArg("--yes");
  }
  if (input.dryRun) pushArg("--dry-run");

  if (mode === "auto") {
    pushArg("--auto-mode", prompt, "--max-runtime", String(input.maxRuntime || 120));
  } else if (mode === "goal") {
    pushArg("--goal", prompt);
  } else if (mode === "permissions") {
    pushArg("--permissions");
  } else {
    pushArg("--prompt", prompt);
  }

  return { args, displayArgs, workspace, prompt, mode, agentRuntime };
}

function autohandClientName(agentRuntime) {
  return `autohand-squad-${agentRuntime.agentId}`;
}

function agentRuntimeEnvVars(agentRuntime) {
  return {
    AUTOHAND_HOME: agentRuntime.agentHome,
    AUTOHAND_CONFIG: agentRuntime.configPath,
    AUTOHAND_CLIENT_NAME: autohandClientName(agentRuntime),
    AUTOHAND_NO_IDLE_LOGOUT: "1",
    AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: "",
    ...(agentRuntime.computerUse ? { AUTOHAND_SQUAD_COMPUTER_USE_SESSION: agentRuntime.computerUse.id } : {}),
  };
}

function selectedModelForInput(input, permissions, agentRuntime) {
  return input.model || agentRuntime?.resolvedProvider?.model || (permissions.modelSecurityEnabled && permissions.modelSecurity.model ? permissions.modelSecurity.model : "");
}

function sdkSupportedMode(mode) {
  return mode === "prompt";
}

function sdkTransportEnabled(input, mode) {
  if (!sdkSupportedMode(mode)) return false;
  if (input.transport === "cli") return false;
  return process.env.AUTOHAND_SQUAD_TRANSPORT !== "cli";
}

function sdkRuntimeContext(input, workspace, profile, agentRuntime) {
  profile = [runtimeProfilePrompt(profile, agentRuntime), computerUseInstructions(agentRuntime), connectorInstructions(agentRuntime.connectorServers), vaultInstructions(agentRuntime), teamInstructionsFor(agentRuntime), recallInstructions(input), workPlanInstructions(input), memberShapingInstructions(input)].filter(Boolean).join("\n\n");
  const permissions = normalizeAgentPermissions(agentRuntime.agent);
  const associatedProjects = normalizeAgentProjects(agentRuntime.agent);
  const model = selectedModelForInput(input, permissions, agentRuntime);
  const addDir = [];
  const displayAddDir = [];

  if (agentRuntime.profileDocs?.path) {
    addDir.push(agentRuntime.profileDocs.path);
    displayAddDir.push(agentRuntime.profileDocs.displayPath || "<agent-profile-dir>");
  }

  for (const project of associatedProjects) {
    if (project.path === workspace) continue;
    addDir.push(project.path);
    displayAddDir.push(project.label || project.path);
  }
  if (canvasDirFor(input)) {
    addDir.push(canvasDirFor(input));
    displayAddDir.push("<canvas>");
  }

  const extraArgs = ["--path", workspace, "--config", agentRuntime.configPath];
  const displayArgs = ["--mode", "rpc", "--path", workspace, "--config", "<agent-config>"];

  if (autohandSupportsFlag("--no-idle-logout")) {
    extraArgs.push("--no-idle-logout");
    displayArgs.push("--no-idle-logout");
  }

  if (permissions.permissionMode === "unrestricted") {
    extraArgs.push("--unrestricted");
    displayArgs.push("--unrestricted");
  } else if (permissions.permissionMode === "restricted" || input.policy === "restricted") {
    extraArgs.push("--restricted");
    displayArgs.push("--restricted");
  } else if (input.policy === "yes") {
    extraArgs.push("--yes");
    displayArgs.push("--yes");
  }

  if (input.dryRun) {
    extraArgs.push("--dry-run");
    displayArgs.push("--dry-run");
  }

  if (model) {
    displayArgs.push("--model", model);
  }
  for (const item of displayAddDir) {
    displayArgs.push("--add-dir", item);
  }
  if (profile) {
    displayArgs.push("--append-sys-prompt", "<agent-profile>");
  }

  const autohandPath = resolveAutohandBinary();
  const options = {
    cwd: workspace,
    extraArgs,
    envVars: agentRuntimeEnvVars(agentRuntime),
    addDir,
    timeout: 300000,
  };
  if (autohandPath) options.cliPath = autohandPath;
  // The SDK infers a provider from `model` ("moa", "fantail") or takes it from
  // `provider`, and then requires an API key for cloud providers. Account-
  // authenticated Autohand AI has none: the member config (--config) already
  // selects `autohandai` with the synced account token, so neither option is
  // passed and the model goes through the CLI flag instead.
  const accountAuthenticated = agentRuntime.resolvedProvider?.provider === "autohandai" && !agentRuntime.resolvedProvider?.apiKey;
  if (model && accountAuthenticated) extraArgs.push("--model", model);
  else if (model) options.model = model;
  if (agentRuntime.resolvedProvider?.provider && !accountAuthenticated) options.provider = agentRuntime.resolvedProvider.provider;
  if (agentRuntime.resolvedProvider?.apiKey) options.apiKey = agentRuntime.resolvedProvider.apiKey;
  if (agentRuntime.resolvedProvider?.baseUrl && !accountAuthenticated) options.baseUrl = agentRuntime.resolvedProvider.baseUrl;
  if (profile) options.appendSystemPrompt = profile;

  return {
    options,
    command: `autohand ${displayArgs.map(shellQuote).join(" ")}`,
  };
}

// Goal 06: Layered Context Model — ordered layer contract.
// Static product layers (systemContract, teamOperatingRules) are reconstructed
// from versioned app code. Mutable layers carry a content hash and source key so
// they can be summarized later without losing their link to the source of truth.
const contextLayerOrder = [
  "systemContract",
  "teamOperatingRules",
  "agentRoleProfile",
  "projectMemory",
  "taskContextPack",
  "userRequest",
  "recentConversations",
  "workPlan",
  "toolTranscript",
];

const contextLayerStatic = {
  systemContract:
    "Autohand operates each squad member as an isolated CLI instance with explicit permission, file-guard, and model-security policies. Destructive actions and out-of-policy tools require escalation before they run.",
  teamOperatingRules:
    "Preserve task evidence, keep durable rules separate from task-specific context, return blocking findings first, and verify before claiming work is done. Auto-merge stays disabled.",
};

function contextHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function clampSummary(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Goal 08: Context Packs.
// Soft caps keep the model-facing pack compact (~20k token budget) while the
// stored manifest can hold richer metadata. Large file excerpts are truncated
// with a source link; whole large files, build artifacts, and out-of-workspace
// failures are omitted but always reported in the `omitted` list so nothing is
// silently dropped.
const contextPackFileExcerptMax = 10_000;
const contextPackMaxRelevantFiles = 6;
const contextPackMaxScreenshots = 4;
const contextPackMaxFailures = 4;
const contextPackLargeFileBytes = 100 * 1024;

function approxKb(bytes) {
  return Math.max(1, Math.round((Number(bytes) || 0) / 1024));
}

function approxTokens(chars) {
  // Rough heuristic used only for the soft-budget display; ~4 chars/token.
  return Math.max(0, Math.round((Number(chars) || 0) / 4));
}

// Collect a recent, summarized git diff scoped to the workspace. Returns null
// when the workspace is not a git repo or git is unavailable.
function contextPackRecentDiff(workspace) {
  const rootResult = spawnSync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (rootResult.status !== 0) return null;
  const repoRoot = rootResult.stdout.trim();
  if (!repoRoot || !isPathInside(workspace, repoRoot)) return null;

  const statResult = spawnSync("git", ["-C", workspace, "diff", "--stat", "--", "."], {
    encoding: "utf8",
    maxBuffer: 512 * 1024,
    timeout: 4000,
  });
  const logResult = spawnSync("git", ["-C", workspace, "log", "-3", "--oneline", "--no-color", "--", "."], {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: 4000,
  });
  const stat = statResult.status === 0 ? statResult.stdout.trim() : "";
  const recentCommits = logResult.status === 0
    ? logResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  if (!stat && !recentCommits.length) return null;

  const changedFiles = stat
    ? stat.split(/\r?\n/).slice(0, -1).map((line) => line.trim()).filter(Boolean).length
    : 0;
  return { stat, recentCommits, changedFiles };
}

// Read a per-file excerpt for the pack. Large files are omitted (link only);
// otherwise the excerpt is truncated at the soft budget with a source link.
function contextPackFileExcerpt(workspace, relPath) {
  const abs = resolve(workspace, relPath);
  if (!isPathInside(abs, workspace) || !existsSync(abs)) return null;
  let info;
  try {
    info = statSync(abs);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  const bytes = info.size;
  if (bytes > contextPackLargeFileBytes) {
    return { path: relPath, bytes, omitted: true, reason: "large-file" };
  }
  let content = "";
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return { path: relPath, bytes, omitted: true, reason: "binary-or-unreadable" };
  }
  const truncated = content.length > contextPackFileExcerptMax;
  const excerpt = truncated ? `${content.slice(0, contextPackFileExcerptMax)}\n… [truncated]` : content;
  return {
    path: relPath,
    bytes,
    truncated,
    excerpt,
    sourceRef: relPath,
  };
}

// Resolve prior failures from the launch payload's task timeline/handoffs,
// scoped to this workspace. Failures recorded against another workspace are
// omitted (and reported) so the pack stays workspace-scoped.
function contextPackPriorFailures(payload, workspace) {
  const task = payload?.task && typeof payload.task === "object" ? payload.task : null;
  const included = [];
  const omitted = [];
  if (!task) return { included, omitted };
  const timeline = Array.isArray(task.timeline) ? task.timeline : [];
  for (const event of timeline) {
    const type = String(event?.evidenceType || event?.type || "");
    const isFailure = /risk|fail/i.test(type) || (Array.isArray(event?.unresolvedRisks) && event.unresolvedRisks.length);
    if (!isFailure) continue;
    const eventWorkspace = String(event?.workspace || task?.workspace || "");
    if (eventWorkspace && workspace && resolve(eventWorkspace) !== resolve(workspace)) {
      omitted.push({ summary: clampSummary(event?.summary || type, 160), reason: "other-workspace" });
      continue;
    }
    included.push({
      id: String(event?.id || ""),
      at: String(event?.at || ""),
      summary: clampSummary(event?.summary || (event?.unresolvedRisks || []).join("; ") || type, 200),
    });
    if (included.length >= contextPackMaxFailures) break;
  }
  return { included, omitted };
}

// Collect distilled user preferences from the agent profile (durable role
// preferences, not task context). These ride along as compact lines.
function contextPackUserPreferences(agent) {
  const memory = Array.isArray(agent?.memory) ? agent.memory.filter(Boolean) : [];
  const prefs = [];
  if (agent?.role) prefs.push(`Role: ${agent.role}`);
  const perms = agent?.permissions && typeof agent.permissions === "object" ? agent.permissions : {};
  if (perms.permissionMode) prefs.push(`Permission mode: ${perms.permissionMode}`);
  for (const item of memory.slice(0, 3)) prefs.push(clampSummary(item, 160));
  return prefs;
}

function collaborationLayerSummary(collaboration) {
  if (!collaboration || typeof collaboration !== "object") return "";
  const handoff = collaboration.handoff && typeof collaboration.handoff === "object" ? collaboration.handoff : {};
  const task = collaboration.task && typeof collaboration.task === "object" ? collaboration.task : {};
  const role = collaboration.role === "receiver" ? "receiver" : collaboration.role === "source" ? "source" : "member";
  return clampSummary(
    [
      `Squad collaboration ${role}`,
      collaboration.sourceAgentId && collaboration.targetAgentId ? `${collaboration.sourceAgentId} -> ${collaboration.targetAgentId}` : "",
      task.title || task.id ? `Task: ${task.title || task.id}` : "",
      handoff.reason ? `Reason: ${handoff.reason}` : "",
      handoff.requiredContext ? `Context: ${handoff.requiredContext}` : "",
    ].filter(Boolean).join("; "),
    280
  );
}

function channelLayerSummary(channelContext) {
  if (!channelContext) return "";
  return clampSummary(
    [
      `Squad channel ${channelContext.channelName || channelContext.channelId} (${channelContext.visibility})`,
      channelContext.threadId ? `Thread: ${channelContext.threadId}` : "",
      channelContext.parentMessageId ? `Reply to: ${channelContext.parentMessageId}` : "",
      channelContext.memberIds.length ? `Members: ${channelContext.memberIds.slice(0, 6).join(", ")}` : "",
      `Auto mode (self-judge): ${channelContext.autoModeDefault || channelContext.selfJudge ? "on" : "off"}`,
    ].filter(Boolean).join("; "),
    280
  );
}

// Goal 08: build the context pack assembled before a run starts. Collects the
// repo summary, relevant files (excerpts), recent diffs, prior failures, user
// preferences, active route, and available screenshots — scoped to the selected
// workspace. Returns a manifest with `included`/`omitted` sections, a compact
// model-facing summary, and source links for everything that overflows the
// model budget.
function generateContextPack(mode, payload, agentRuntime, workspace) {
  const agent = payload?.agent && typeof payload.agent === "object" ? payload.agent : {};
  const task = payload?.task && typeof payload.task === "object" ? payload.task : null;
  const activeRoute = String(payload?.activeRoute || payload?.route || "").trim();
  const pinned = Array.isArray(payload?.pinnedFiles) ? payload.pinnedFiles.filter((p) => typeof p === "string") : [];
  const requestedFiles = Array.isArray(payload?.contextFiles) ? payload.contextFiles.filter((p) => typeof p === "string") : [];
  const omitted = [];

  // Repo summary + workspace file inventory (already workspace-scoped + ignore-aware).
  let allFiles = [];
  try {
    allFiles = listGitWorkspaceFiles(workspace) || [];
  } catch {
    allFiles = [];
  }
  const repoKind = existsSync(join(workspace, ".git")) ? "git repo" : "project";
  const repoSummary = {
    workspace,
    label: relative(homeDir, workspace) || basename(workspace),
    kind: repoKind,
    fileCount: allFiles.length,
  };

  // Relevant files: pinned + explicitly requested first (pinned bypasses
  // ranking but still counts against the budget), then a small sample.
  const ordered = [];
  const seen = new Set();
  for (const rel of [...pinned, ...requestedFiles]) {
    if (rel && !seen.has(rel) && allFiles.includes(rel)) {
      seen.add(rel);
      ordered.push({ path: rel, pinned: pinned.includes(rel) });
    }
  }
  for (const rel of allFiles) {
    if (ordered.length >= contextPackMaxRelevantFiles) break;
    if (seen.has(rel)) continue;
    seen.add(rel);
    ordered.push({ path: rel, pinned: false });
  }
  if (allFiles.length > ordered.length) {
    omitted.push({
      section: "files",
      reason: "ranking-budget",
      detail: `${allFiles.length - ordered.length} additional workspace file(s) not excerpted; available via source links.`,
    });
  }

  const includedFiles = [];
  let totalExcerptChars = 0;
  for (const entry of ordered) {
    const excerpt = contextPackFileExcerpt(workspace, entry.path);
    if (!excerpt) {
      omitted.push({ section: "files", path: entry.path, reason: "unreadable" });
      continue;
    }
    if (excerpt.omitted) {
      omitted.push({
        section: "files",
        path: entry.path,
        reason: excerpt.reason === "large-file" ? "large-file" : excerpt.reason,
        bytes: excerpt.bytes,
        detail: excerpt.reason === "large-file"
          ? `File is ${approxKb(excerpt.bytes)} KB (> ${approxKb(contextPackLargeFileBytes)} KB); excerpt omitted, source linked.`
          : "File could not be read as text; source linked.",
      });
      continue;
    }
    totalExcerptChars += excerpt.excerpt.length;
    includedFiles.push({ ...excerpt, pinned: entry.pinned });
  }

  const diff = contextPackRecentDiff(workspace);
  if (!diff) {
    omitted.push({ section: "diffs", reason: repoKind === "git repo" ? "no-recent-changes" : "not-a-git-repo" });
  }

  const failures = contextPackPriorFailures(payload, workspace);
  for (const failure of failures.omitted) {
    omitted.push({ section: "priorFailures", reason: failure.reason, detail: failure.summary });
  }

  const preferences = contextPackUserPreferences(agent);

  // Screenshots: from the launch payload (captured feedback), workspace-scoped.
  const payloadShots = Array.isArray(payload?.screenshots) ? payload.screenshots.filter(Boolean) : [];
  const screenshots = payloadShots.slice(0, contextPackMaxScreenshots).map((shot) => ({
    label: clampSummary(typeof shot === "string" ? shot : shot?.label || shot?.path || "screenshot", 120),
    path: typeof shot === "string" ? shot : String(shot?.path || ""),
    route: typeof shot === "object" ? String(shot?.route || activeRoute || "") : activeRoute,
  }));
  if (payloadShots.length > screenshots.length) {
    omitted.push({ section: "screenshots", reason: "budget", detail: `${payloadShots.length - screenshots.length} additional screenshot(s) not embedded.` });
  }

  const totalChars =
    totalExcerptChars +
    (diff?.stat?.length || 0) +
    preferences.join("").length +
    failures.included.reduce((sum, f) => sum + (f.summary?.length || 0), 0);

  const summaryParts = [
    `${includedFiles.length} file excerpt(s)`,
    diff ? `${diff.changedFiles} changed file(s) in recent diff` : "no recent diff",
    `${failures.included.length} prior failure(s)`,
    `${screenshots.length} screenshot(s)`,
  ];
  const summary = `Context pack for ${repoSummary.label}: ${summaryParts.join(", ")}.`;

  const id = `pack_${contextHash({ workspace, mode, files: includedFiles.map((f) => f.path), at: Date.now() }).slice(7, 19)}`;

  const pack = {
    id,
    version: 1,
    mode,
    workspace,
    activeRoute: activeRoute || null,
    taskId: task?.id ? String(task.id) : null,
    generatedAt: new Date().toISOString(),
    summary,
    softTokenBudget: 20_000,
    approxTokens: approxTokens(totalChars),
    included: {
      repoSummary,
      files: includedFiles,
      recentDiff: diff,
      priorFailures: failures.included,
      userPreferences: preferences,
      activeRoute: activeRoute || null,
      screenshots,
    },
    omitted,
    counts: {
      files: includedFiles.length,
      diffs: diff ? 1 : 0,
      priorFailures: failures.included.length,
      screenshots: screenshots.length,
      omitted: omitted.length,
    },
  };
  // The compact model-facing view ships truncated excerpts + source refs; the
  // full manifest above keeps richer metadata for inspection.
  pack.modelView = contextPackModelView(pack);
  return pack;
}

// Produce the compact, model-facing view of a stored context pack. The full
// manifest (with whole excerpts) stays server-side; the model prompt gets
// truncated excerpts and source links for overflow.
function contextPackModelView(pack) {
  if (!pack || typeof pack !== "object") return null;
  const included = pack.included || {};
  return {
    id: pack.id,
    summary: pack.summary,
    repoSummary: included.repoSummary || null,
    files: (included.files || []).map((file) => ({
      path: file.path,
      pinned: Boolean(file.pinned),
      truncated: Boolean(file.truncated),
      excerpt: file.excerpt,
      sourceRef: file.sourceRef || file.path,
    })),
    recentDiff: included.recentDiff
      ? { stat: included.recentDiff.stat, recentCommits: included.recentDiff.recentCommits }
      : null,
    priorFailures: (included.priorFailures || []).map((failure) => failure.summary),
    userPreferences: included.userPreferences || [],
    activeRoute: included.activeRoute || null,
    screenshots: (included.screenshots || []).map((shot) => shot.label),
    omittedCount: pack.counts?.omitted || 0,
  };
}

// Assemble the ordered context layers used for a run/chat in any mode
// (chat, prompt, auto, goal). Every defined layer is always returned; omitted
// layers are marked included:false with a reason so nothing is silently skipped.
function assembleContextLayers(mode, payload, agentRuntime) {
  const agent = payload?.agent && typeof payload.agent === "object" ? payload.agent : {};
  const agentId = agentRuntime?.agentId || agent.id || payload?.agentId || "";
  const prompt = String(payload?.prompt || "").trim();
  const memoryItems = Array.isArray(agent.memory) ? agent.memory.filter(Boolean) : [];
  const projects = normalizeAgentProjects(agent, agentRuntime?.workspace || "", true);
  const contextPack = payload?.contextPack && typeof payload.contextPack === "object" ? payload.contextPack : null;
  const channelContext = channelContextFromPayload(payload);
  const collaborationSummary = [collaborationLayerSummary(payload?.collaboration), channelLayerSummary(channelContext)]
    .filter(Boolean)
    .join(" ");
  const taskId = String(payload?.taskId || payload?.task?.id || contextPack?.taskId || "");
  const layers = [];

  layers.push({
    name: "systemContract",
    included: true,
    source: "app:system-contract",
    sourceKey: null,
    sourceRef: "versioned-app",
    contentHash: contextHash(contextLayerStatic.systemContract),
    summary: contextLayerStatic.systemContract,
  });

  layers.push({
    name: "teamOperatingRules",
    included: true,
    source: "app:team-operating-rules",
    sourceKey: null,
    sourceRef: "versioned-app",
    contentHash: contextHash(contextLayerStatic.teamOperatingRules),
    summary: contextLayerStatic.teamOperatingRules,
  });

  const brainCard = agentRuntime?.brainCard || agent.brainCard || null;
  const profilePath = agentRuntime?.profileDocs?.displayPath || "";
  if (brainCard || profilePath) {
    layers.push({
      name: "agentRoleProfile",
      included: true,
      source: profilePath || "agent:role-profile",
      sourceKey: agentId || null,
      sourceRef: "agent",
      contentHash: contextHash({ brainCard, profilePath }),
      summary: clampSummary(
        brainCard?.purpose ||
          agent.role ||
          (profilePath ? `Role profile docs at ${profilePath}` : "Agent role profile")
      ),
    });
  } else {
    layers.push({
      name: "agentRoleProfile",
      included: false,
      source: null,
      sourceKey: agentId || null,
      sourceRef: "agent",
      contentHash: null,
      summary: "",
      reason: "Role profile not configured for this squad member.",
    });
  }

  if (memoryItems.length) {
    layers.push({
      name: "projectMemory",
      included: true,
      source: "agent:memory",
      sourceKey: agentId || null,
      sourceRef: "memory",
      contentHash: contextHash(memoryItems),
      summary: clampSummary(`${memoryItems.length} saved memory item(s): ${memoryItems.slice(0, 3).join("; ")}`),
    });
  } else {
    layers.push({
      name: "projectMemory",
      included: false,
      source: null,
      sourceKey: agentId || null,
      sourceRef: "memory",
      contentHash: null,
      summary: "",
      reason: "No durable project memory configured.",
    });
  }

  if (contextPack || projects.length || collaborationSummary) {
    const packSummary = contextPack?.summary
      ? clampSummary(contextPack.summary)
      : projects.length
        ? clampSummary(`${projects.length} project path(s): ${projects.map((project) => project.label || project.name).slice(0, 3).join("; ")}`)
        : collaborationSummary;
    layers.push({
      name: "taskContextPack",
      included: true,
      source: contextPack ? "task:context-pack" : collaborationSummary ? "task:collaboration-handoff" : "agent:projects",
      sourceKey: taskId || contextPack?.id || null,
      sourceRef: "task",
      contentHash: contextHash(contextPack || { projects, collaboration: payload?.collaboration || null, channel: channelContext }),
      summary: collaborationSummary && packSummary !== collaborationSummary ? `${packSummary} ${collaborationSummary}` : packSummary,
    });
  } else {
    layers.push({
      name: "taskContextPack",
      included: false,
      source: null,
      sourceKey: taskId || null,
      sourceRef: "task",
      contentHash: null,
      summary: "",
      reason: "No task context pack or project paths attached.",
    });
  }

  if (mode === "permissions" || !prompt) {
    layers.push({
      name: "userRequest",
      included: false,
      source: null,
      sourceKey: null,
      sourceRef: "run",
      contentHash: null,
      summary: "",
      reason: mode === "permissions" ? "Permissions check carries no user request." : "No user request text in this run.",
    });
  } else {
    layers.push({
      name: "userRequest",
      included: true,
      source: `run:${mode}`,
      sourceKey: null,
      sourceRef: "run",
      contentHash: contextHash(prompt),
      summary: clampSummary(prompt),
    });
  }

  // Earlier conversations (ADR-0115): present on direct-message turns, so a
  // reader of Work details can see the member was told what came before.
  const recall = payload?._recall && typeof payload._recall === "object" ? payload._recall : null;
  layers.push({
    name: "recentConversations",
    included: Boolean(recall?.text),
    source: "bridge:chats",
    sourceKey: null,
    sourceRef: "chats+runs+channels",
    contentHash: recall?.text ? contextHash(recall.text) : null,
    summary: recall?.text
      ? clampSummary(`${recall.counts.ownChats} previous chat(s), ${recall.counts.otherTurns + recall.counts.otherChats} from other members, ${recall.counts.channels} channel(s).`)
      : "",
    ...(recall?.text ? {} : { reason: payload?.channelId || payload?.channel?.channelId ? "Channel turns carry the thread instead." : "Nothing earlier to recall yet." }),
  });

  // Your work plan (ADR-0124): the member's tasks, routines, goals and queued
  // follow-ups, present on direct-message turns.
  const workPlan = payload?._workPlan && typeof payload._workPlan === "object" ? payload._workPlan : null;
  layers.push({
    name: "workPlan",
    included: Boolean(workPlan?.text),
    source: "bridge:work",
    sourceKey: null,
    sourceRef: "work+routines+goals+queues",
    contentHash: workPlan?.text ? contextHash(workPlan.text) : null,
    summary: workPlan?.text ? clampSummary(`${workPlan.counts.tasks} open task(s), ${workPlan.counts.routines} routine(s), ${workPlan.counts.goals} goal(s), ${workPlan.counts.queued} queued follow-up(s).`) : "",
    ...(workPlan?.text ? {} : { reason: payload?.channelId || payload?.channel?.channelId ? "Channel turns carry the thread instead." : "Not a direct-message turn." }),
  });

  // The tool/result transcript is produced while the run executes; recorded as a
  // placeholder layer at assembly time and refreshed from logs in runSummary().
  layers.push({
    name: "toolTranscript",
    included: false,
    source: "run:transcript",
    sourceKey: null,
    sourceRef: "run",
    contentHash: null,
    summary: "",
    reason: "Tool and result transcript is captured while the run executes.",
  });

  return {
    appVersion: "web-prototype",
    mode,
    assembledAt: new Date().toISOString(),
    order: contextLayerOrder.slice(),
    layers,
  };
}

// Build the ordered context manifest for a chat exchange and reflect the
// resulting trace into the toolTranscript layer so it is recorded, not skipped.
function chatContextLayers(payload, agentRuntime, trace) {
  const manifest = assembleContextLayers("chat", payload, agentRuntime);
  const transcript = manifest.layers.find((layer) => layer.name === "toolTranscript");
  if (transcript) {
    const steps = Array.isArray(trace?.steps) ? trace.steps : [];
    const toolCount = Array.isArray(trace?.toolCalls) ? trace.toolCalls.length : steps.length;
    if (toolCount || trace?.reply) {
      transcript.included = true;
      transcript.contentHash = contextHash(trace?.reply || JSON.stringify(steps));
      transcript.summary = clampSummary(
        toolCount ? `${toolCount} tool/result step(s) recorded for this chat reply.` : "Chat reply transcript recorded."
      );
      delete transcript.reason;
    }
  }
  return manifest;
}

// Reflect the live tool/result transcript into the recorded context manifest so
// the toolTranscript layer is present rather than silently skipped after a run.
function finalizeContextLayers(run) {
  const manifest = run?.contextLayers;
  if (!manifest || !Array.isArray(manifest.layers)) return manifest;
  const transcript = manifest.layers.find((layer) => layer.name === "toolTranscript");
  if (!transcript) return manifest;
  const logLines = Array.isArray(run.logs) ? run.logs : [];
  if (logLines.length) {
    transcript.included = true;
    transcript.contentHash = contextHash(logLines.map((log) => log.line || "").join("\n"));
    transcript.summary = clampSummary(`${logLines.length} transcript line(s) recorded for this run.`);
    delete transcript.reason;
  }
  return manifest;
}

// Goal 07: Evaluation Hooks — assess a completed run against deterministic
// trust checks. Each check links back to the run log lines or command it
// inspected, never claims certainty when evidence is missing (state="unknown"),
// and records a reason for skipped/unknown states. Failed checks surface as
// unresolved risk in the UI. This runs only after a run has finished.
const RUN_FILE_PATH_RE =
  /(?:^|[\s(["'`])([~./\w@-]+\/[\w@./-]+\.(?:[cm]?[jt]sx?|vue|css|scss|md|json|mjs|cjs|rs|py|html|ya?ml|toml|sh|go|rb)|[\w@.-]+\.(?:[cm]?[jt]sx?|vue|css|scss|md|json|mjs|cjs|rs|py|html|ya?ml|toml|sh|go|rb))/gi;
const RUN_VERIFY_RE =
  /\b(test|tests|build|lint|typecheck|cargo build|cargo test|cargo check|npm (?:run )?(?:test|build)|bun (?:run )?(?:test|build)|node --check|vitest|jest|pytest|playwright)\b/i;
const RUN_VERIFY_PASS_RE = /\b(pass(?:ed|ing)?|ok|success(?:ful)?|built in|0 failures|✓|all checks passed|exit code 0|exited with code 0)\b/i;
const RUN_VERIFY_FAIL_RE = /\b(fail(?:ed|ing|ures?)?|error|✗|exit code [1-9]|exited with code [1-9])\b/i;
const RUN_USER_EVIDENCE_RE = /\b(screenshot|preview|deploy(?:ed|ment)?|url|http(?:s)?:\/\/|rendered|demo|recording)\b/i;
const RUN_UNSUPPORTED_CLAIM_RE =
  /\b(should (?:now )?work|likely works|probably (?:works|fixed)|i (?:believe|assume|think it)|appears? to (?:work|be fixed)|seems? (?:to work|fine)|done(?:!|\.)? (?:without|no) (?:test|verif))\b/i;

function evidenceRef(source, label, detail = "") {
  return { source, label: clampSummary(label, 160), detail: clampSummary(detail, 200) };
}

function evaluateRun(run) {
  if (!run || !["completed", "failed", "stopped"].includes(run.status)) return null;
  const logLines = Array.isArray(run.logs) ? run.logs : [];
  const logText = logLines.map((log) => String(log.line || "")).join("\n");
  const command = String(run.command || "");
  const combined = `${command}\n${logText}`;
  const changedFiles = Array.from(new Set((logText.match(RUN_FILE_PATH_RE) || []).map((m) => m.replace(/^[\s(["'`]+/, "").replace(/[),.;:"'`]+$/, "")).filter(Boolean)));
  const allowedPaths = Array.isArray(run.contextLayers?.layers)
    ? run.contextLayers.layers.filter((layer) => layer.sourceRef === "task" && layer.included).length
    : 0;
  const checks = [];

  // 1. File citations (deterministic): did the run reference specific files?
  if (changedFiles.length) {
    checks.push({
      id: "citations",
      state: "pass",
      decision: "deterministic",
      confidence: "high",
      reason: `${changedFiles.length} file path(s) cited in run output.`,
      evidence: changedFiles.slice(0, 6).map((path) => evidenceRef("file", path, "Cited in run output.")),
    });
  } else {
    checks.push({
      id: "citations",
      state: "unknown",
      decision: "deterministic",
      confidence: "low",
      reason: "No file paths were detected in run output, so citation coverage cannot be confirmed.",
      evidence: [],
    });
  }

  // 2. Verification run (deterministic where possible, else skip with reason).
  const verifyLines = logLines.filter((log) => RUN_VERIFY_RE.test(String(log.line || "")));
  if (RUN_VERIFY_RE.test(command) || verifyLines.length) {
    const verifyText = `${RUN_VERIFY_RE.test(command) ? command : ""}\n${verifyLines.map((l) => l.line).join("\n")}`;
    const failed = RUN_VERIFY_FAIL_RE.test(verifyText) && !RUN_VERIFY_PASS_RE.test(verifyText);
    const passed = RUN_VERIFY_PASS_RE.test(verifyText) || run.exitCode === 0;
    checks.push({
      id: "verification",
      state: failed ? "fail" : passed ? "pass" : "unknown",
      decision: "deterministic",
      confidence: passed || failed ? "high" : "low",
      reason: failed
        ? "A verification command reported a failure or non-zero exit."
        : passed
          ? "A verification command ran and reported success."
          : "A verification command ran but its result could not be parsed.",
      evidence: [
        RUN_VERIFY_RE.test(command) ? evidenceRef("command", command, "Verification command for this run.") : null,
        ...verifyLines.slice(0, 4).map((log) => evidenceRef("run-log", log.line, log.at || "")),
      ].filter(Boolean),
    });
  } else {
    checks.push({
      id: "verification",
      state: "skip",
      decision: "deterministic",
      confidence: "high",
      reason: "No verification command (test, build, lint, typecheck) was available in this run.",
      evidence: [],
    });
  }

  // 3. Scoped changes (deterministic): did changes stay within attached paths?
  if (!changedFiles.length) {
    checks.push({
      id: "scope",
      state: "skip",
      decision: "deterministic",
      confidence: "high",
      reason: "No file changes were detected, so change scope does not apply.",
      evidence: [],
    });
  } else if (allowedPaths) {
    checks.push({
      id: "scope",
      state: "pass",
      decision: "deterministic",
      confidence: "medium",
      reason: `${changedFiles.length} changed file(s) align with the attached task context pack.`,
      evidence: changedFiles.slice(0, 6).map((path) => evidenceRef("file", path, "Changed within attached scope.")),
    });
  } else {
    checks.push({
      id: "scope",
      state: "unknown",
      decision: "deterministic",
      confidence: "low",
      reason: "Changed files were detected but no task context pack defined the intended scope to compare against.",
      evidence: changedFiles.slice(0, 6).map((path) => evidenceRef("file", path, "Changed file.")),
    });
  }

  // 4. User-facing evidence (deterministic signal).
  const userEvidenceLines = logLines.filter((log) => RUN_USER_EVIDENCE_RE.test(String(log.line || "")));
  if (userEvidenceLines.length) {
    checks.push({
      id: "user-evidence",
      state: "pass",
      decision: "deterministic",
      confidence: "medium",
      reason: "Run output references user-facing evidence (screenshot, preview, or deploy).",
      evidence: userEvidenceLines.slice(0, 4).map((log) => evidenceRef("run-log", log.line, log.at || "")),
    });
  } else {
    checks.push({
      id: "user-evidence",
      state: "unknown",
      decision: "deterministic",
      confidence: "low",
      reason: "No user-facing artifact (screenshot, preview, deploy) was detected in run output.",
      evidence: [],
    });
  }

  // 5. Unsupported claims (model-assisted heuristic; flag, do not assert).
  const claimLines = logLines.filter((log) => RUN_UNSUPPORTED_CLAIM_RE.test(String(log.line || "")));
  const verificationPassed = checks.find((c) => c.id === "verification")?.state === "pass";
  if (claimLines.length && !verificationPassed) {
    checks.push({
      id: "unsupported-claims",
      state: "fail",
      decision: "model",
      confidence: "medium",
      reason: "Run output contains success-style language without a passing verification check to back it.",
      evidence: claimLines.slice(0, 4).map((log) => evidenceRef("run-log", log.line, log.at || "")),
    });
  } else if (claimLines.length) {
    checks.push({
      id: "unsupported-claims",
      state: "pass",
      decision: "model",
      confidence: "low",
      reason: "Success-style language appears but a passing verification check supports it.",
      evidence: claimLines.slice(0, 2).map((log) => evidenceRef("run-log", log.line, log.at || "")),
    });
  } else {
    checks.push({
      id: "unsupported-claims",
      state: "unknown",
      decision: "model",
      confidence: "low",
      reason: "Not enough final-answer text was captured to judge whether claims are supported.",
      evidence: [],
    });
  }

  const failed = checks.filter((c) => c.state === "fail").length;
  const passed = checks.filter((c) => c.state === "pass").length;
  const summaryState = failed ? "some-fail" : passed === checks.length ? "all-pass" : "incomplete";

  return {
    evaluatedAt: run.finishedAt || new Date().toISOString(),
    evaluatorNote:
      summaryState === "all-pass"
        ? "All trust checks passed against recorded run evidence."
        : summaryState === "some-fail"
          ? "One or more trust checks failed; treat as low-trust pending review."
          : "Some checks could not be determined from available evidence; no certainty is claimed.",
    summaryState,
    passed,
    failed,
    total: checks.length,
    contentHash: contextHash(`${combined}\n${checks.map((c) => `${c.id}:${c.state}`).join(",")}`),
    checks,
  };
}

function runSummary(run) {
  return {
    id: run.id,
    agentId: run.agentId,
    title: run.title,
    mode: run.mode,
    workspace: run.workspace,
    configPath: run.configPath,
    displayConfigPath: run.displayConfigPath,
    agentHome: run.agentHome,
    effectiveModel: run.effectiveModel || null,
    skillInstall: run.skillInstall,
    profileDocs: run.profileDocs,
    brainCard: run.brainCard,
    transport: run.transport || "cli",
    harness: run.harness || DEFAULT_HARNESS_ID,
    harnessVersion: run.harnessVersion || "",
    command: run.command,
    logPath: run.logPath,
    status: run.status,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    channel: run.channel || null,
    reply: run.reply || "",
    // Interrupted by a restart (ADR-0123): Retry is offered while the launch
    // payload is still held and the run has not been retried yet.
    interrupted: run.interrupted === true,
    retryable: run.status === "interrupted" && Boolean(run.launch) && !run.retryItemId,
    retriedAt: run.retriedAt || "",
    retryItemId: run.retryItemId || "",
    channelActions: run.channelActions || [],
    computerUse: run.computerUse || null,
    contextPack: run.contextPack || null,
    contextLayers: finalizeContextLayers(run),
    evaluation: evaluateRun(run),
    logs: run.logs.slice(-260),
  };
}

function isLiveRun(run) {
  return ["queued", "running", "launching"].includes(run?.status);
}

// Stop one live run: its child process, SDK client, and abort controller.
// Returns true when something was actually stopped.
async function stopRun(run, reason = "stopped") {
  let stopped = false;
  // Mark and cancel before awaiting an adapter: its pending completion must
  // not commit a channel action while Stop waits for the child to acknowledge.
  run.status = "stopped";
  if (run.abortController && !run.abortController.signal.aborted) {
    run.abortController.abort();
    stopped = true;
  }
  const child = run.process;
  if (child && !childHasExited(child)) {
    try {
      terminateChildProcess(child, {
        onForce: () => appendLog(run, "system", "Autohand CLI did not stop after SIGTERM; forcing stop"),
      });
      stopped = true;
    } catch (error) {
      appendLog(run, "system", `stop failed: ${error.message}`);
    }
  }
  if (run.sdk) {
    try {
      await run.sdk.interrupt?.();
      await run.sdk.close?.();
      stopped = true;
    } catch (error) {
      appendLog(run, "system", `SDK stop failed: ${error.message}`);
    } finally {
      run.sdk = null;
    }
  }
  run.finishedAt = new Date().toISOString();
  emitRunFinished(run);
  appendLog(run, "system", reason);
  return stopped;
}

async function stopManagedRuns(reason = "service stopped") {
  projectObserver.stop();
  let stoppedRuns = 0;
  for (const memberId of new Set((await goals.list()).filter((goal) => goal.status === "running").map((goal) => goal.agentId))) await goals.pauseForMember(memberId, reason);
  for (const memberId of activeChats.keys()) stopChats(memberId);
  harnessLogins.cancelAll();
  if (sdkSessions) {
    stoppedRuns += await sdkSessions.closeAll(reason).catch(() => 0);
  }
  for (const run of runs.values()) {
    if (!isLiveRun(run)) continue;
    if (await stopRun(run, reason)) stoppedRuns += 1;
  }
  await Promise.allSettled([...computerWorkRuntimes.keys()].map(finishComputerWork));
  return { stoppedRuns };
}

function shutdownServer() {
  if (shuttingDown) return;
  shuttingDown = true;
  computerUse.close();
  projectObserver.stop();
  logEvent(SEVERITY.INFO, "bridge shutting down");
  void runHistory.flush();
  void otel.close();
  setTimeout(() => {
    const exit = () => process.exit(0);
    if (server) {
      server.close(exit);
      setTimeout(exit, 750).unref();
    } else {
      exit();
    }
  }, 50).unref();
}

function runLogSeverity(source, line) {
  if (source === "stderr") return /\b(error|failed|panic|fatal)\b/i.test(line) ? SEVERITY.ERROR : SEVERITY.WARN;
  if (source === "system" && /\b(failed|error)\b/i.test(line)) return SEVERITY.ERROR;
  return SEVERITY.INFO;
}

function appendLog(run, source, chunk) {
  const lines = String(chunk)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter(Boolean);
  const at = new Date().toISOString();
  for (const line of lines) {
    run.logs.push({ source, line, at });
    if (run.logPath) {
      // Each line is one OTLP/JSON log record appended to the run's file; the
      // run id doubles as the trace id so every record of a run correlates.
      otel.record({
        file: run.logPath,
        body: line,
        severityNumber: runLogSeverity(source, line),
        timestamp: Date.parse(at),
        traceId: traceIdFor(run.id),
        spanId: spanIdFor(run.id),
        attributes: {
          "log.source": source,
          "autohand.run.id": run.id,
          "autohand.run.kind": run.kind || "",
          "autohand.harness": run.harness || run.harnessId || "autohand",
          "autohand.member.id": run.agentId || "",
          "autohand.workspace": run.workspace || "",
        },
      });
    }
  }
  if (run.logs.length > maxRunLogLines) run.logs.splice(0, run.logs.length - maxRunLogLines);
}

function stripAnsi(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

function nonEmptyString(value) {
  const text = String(value || "").trim();
  return text ? text : null;
}

function boundedString(value, fallback = "", maxLength = 160) {
  const text = String(value || fallback || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeLiveStatusMember(item = {}) {
  const id = boundedString(item.id, "", 96);
  const name = boundedString(item.name, "Squad member", 80);
  if (!id || !name) return null;
  const avatar = typeof item.avatar === "string" && item.avatar.length <= 131072 && (item.avatar.startsWith("/avatars/") || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.avatar)) ? item.avatar : "";
  return {
    id,
    name,
    avatar,
    role: nonEmptyString(boundedString(item.role, "", 80)),
    status: boundedString(item.status, "online", 32).toLowerCase(),
    working: Boolean(item.working),
    queuedJobs: safeCount(item.queuedJobs),
    scheduledJobs: safeCount(item.scheduledJobs),
    lastActivityAt: nonEmptyString(boundedString(item.lastActivityAt, "", 80)),
  };
}

function normalizeLiveStatusJob(item = {}) {
  const id = boundedString(item.id, "", 96);
  const title = boundedString(item.title, "Squad job", 120);
  if (!id || !title) return null;
  return {
    id,
    title,
    status: boundedString(item.status, "queued", 32).toLowerCase(),
    agentId: nonEmptyString(boundedString(item.agentId, "", 96)),
    agentName: nonEmptyString(boundedString(item.agentName, "", 80)),
    source: nonEmptyString(boundedString(item.source, "", 48)),
    workspace: nonEmptyString(boundedString(item.workspace, "", 180)),
    scheduledFor: nonEmptyString(boundedString(item.scheduledFor, "", 80)),
    updatedAt: nonEmptyString(boundedString(item.updatedAt, "", 80)),
  };
}

function normalizeLiveStatusAutomation(item = {}) {
  const id = boundedString(item.id, "", 96);
  const name = boundedString(item.name, "Workflow", 120);
  if (!id || !name) return null;
  return {
    id,
    name,
    status: boundedString(item.status, "active", 32).toLowerCase(),
    agentId: nonEmptyString(boundedString(item.agentId, "", 96)),
    agentName: nonEmptyString(boundedString(item.agentName, "", 80)),
    triggerType: nonEmptyString(boundedString(item.triggerType, "", 48)),
    schedule: nonEmptyString(boundedString(item.schedule, "", 120)),
    workspace: nonEmptyString(boundedString(item.workspace, "", 180)),
    updatedAt: nonEmptyString(boundedString(item.updatedAt, "", 80)),
  };
}

function normalizeLiveStatusSnapshot(input = {}) {
  const updatedAt = new Date().toISOString();
  return {
    source: "web-console",
    updatedAt,
    lastActivityAt: nonEmptyString(input.lastActivityAt) || updatedAt,
    currentRoute: normalizeFeedbackRoute(input.currentRoute || "/mission-control"),
    onlineMembers: safeCount(input.onlineMembers),
    workingAgents: safeCount(input.workingAgents),
    queuedJobs: safeCount(input.queuedJobs),
    scheduledJobs: safeCount(input.scheduledJobs),
    activeWork: safeCount(input.activeWork),
    queueDepth: safeCount(input.queueDepth),
    totalRuns: safeCount(input.totalRuns),
    members: (Array.isArray(input.members) ? input.members : [])
      .map(normalizeLiveStatusMember)
      .filter(Boolean)
      .slice(0, 80),
    jobs: (Array.isArray(input.jobs) ? input.jobs : [])
      .map(normalizeLiveStatusJob)
      .filter(Boolean)
      .slice(0, 80),
    automations: (Array.isArray(input.automations) ? input.automations : [])
      .map(normalizeLiveStatusAutomation)
      .filter(Boolean)
      .slice(0, 80),
  };
}

async function writeLiveStatusSnapshot(input) {
  const snapshot = normalizeLiveStatusSnapshot(input);
  await mkdir(squadStateDir, { recursive: true });
  await writeFile(liveStatusPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  for (const member of snapshot.members) if (member.working || member.queuedJobs) projectObserver.deferMember(member.id, "Assigned human work takes priority.");
  return snapshot;
}

function normalizeFeedbackKind(value) {
  return value === "bug" ? "bug" : "feedback";
}

function normalizeFeedbackRoute(value) {
  let route = String(value || "/mission-control").trim();
  if (!route) route = "/mission-control";
  try {
    if (route.startsWith("http://") || route.startsWith("https://")) {
      const parsed = new URL(route);
      route = `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    route = "/mission-control";
  }
  route = route.split("#")[0] || "/mission-control";
  if (!route.startsWith("/")) route = `/${route}`;
  return stripFeedbackModalParams(route).slice(0, 600);
}

function stripFeedbackModalParams(route) {
  const [path, query = ""] = String(route || "/mission-control").split("?");
  if (!query) return path || "/mission-control";
  const params = new URLSearchParams(query);
  params.delete("feedback");
  params.delete("about");
  const nextQuery = params.toString();
  return nextQuery ? `${path || "/mission-control"}?${nextQuery}` : path || "/mission-control";
}

function sanitizeFeedbackText(value, maxLength = 12000) {
  let text = String(value || "");
  if (!text) return "";
  text = text.replaceAll(homeDir, "~");
  text = text.replace(/\/Users\/[^/\s:]+/g, "~/...");
  text = text.replace(/\/home\/[^/\s:]+/g, "~/...");
  text = text.replace(/[A-Z]:\\Users\\[^\\\s:]+/gi, "~\\...");
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]");
  text = text.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [TOKEN_REDACTED]");
  text = text.replace(/(api[_-]?key|token|secret|password|pwd|pass)\s*[:=]\s*['"]?[^'"\s;&]+/gi, "$1=[REDACTED]");
  text = text.replace(/sk-[a-zA-Z0-9]{20,}/gi, "[API_KEY_REDACTED]");
  text = text.replace(/gh[pousr]_[a-zA-Z0-9]{36}/g, "[GITHUB_TOKEN_REDACTED]");
  text = text.replace(/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, "[JWT_REDACTED]");
  text = text.replace(/-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[PRIVATE_KEY_REDACTED]");
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[truncated]` : text;
}

function folderNameOnly(path) {
  const name = basename(String(path || "").replace(/\/+$/, ""));
  return sanitizeFeedbackText(name, 120);
}

async function ensureFeedbackDeviceId() {
  try {
    const existing = (await readFile(squadDeviceIdPath, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // Create a local anonymous id below.
  }
  const deviceId = `device-${process.pid}-${Date.now()}`;
  await mkdir(dirname(squadDeviceIdPath), { recursive: true });
  await writeFile(squadDeviceIdPath, deviceId, "utf8");
  return deviceId;
}

function lineTimestampMs(line, fallbackMs) {
  const text = String(line || "");
  const unixMatch = text.match(/unix-ms:(\d{10,})/);
  if (unixMatch) return Number(unixMatch[1]);
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0]);
    if (Number.isFinite(parsed)) return parsed;
  }
  try {
    const parsed = JSON.parse(text);
    const timestamp = parsed.timestamp || parsed.updatedAt || parsed.createdAt || parsed.at;
    if (timestamp) {
      const parsedMs = Date.parse(String(timestamp));
      if (Number.isFinite(parsedMs)) return parsedMs;
    }
  } catch {
    // Plain text log line.
  }
  return fallbackMs;
}

async function readRecentLogFile(path, source, cutoffMs) {
  try {
    const info = await stat(path);
    const fallbackMs = info.mtimeMs;
    if (fallbackMs < cutoffMs) return [];
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean).slice(-120);
    const entries = path.endsWith(".otlp.jsonl")
      ? lines.flatMap((line) =>
          parseLogEnvelope(line).map((record) => ({
            source,
            timestamp: record.timestamp,
            severity: record.severityText,
            line: sanitizeFeedbackText(typeof record.body === "string" ? record.body : JSON.stringify(record.body), 1200),
          }))
        )
      : lines.map((line) => ({
          source,
          timestamp: new Date(lineTimestampMs(line, fallbackMs)).toISOString(),
          line: sanitizeFeedbackText(line, 1200),
        }));
    return entries.filter((entry) => Date.parse(entry.timestamp) >= cutoffMs).slice(-40);
  } catch {
    return [];
  }
}

async function collectRecentFeedbackLogs() {
  const cutoffMs = Date.now() - 60 * 1000;
  const candidates = [
    [join(squadStateDir, "server.log"), "squad-daemon"],
    [join(squadStateDir, "tray.log"), "squad-tray"],
    [join(squadStateDir, "web-server.log"), "web-server"],
    [join(squadStateDir, "analytics.log"), "squad-analytics"],
    [join(squadStateDir, "telemetry.jsonl"), "squad-telemetry"],
    [webOtelLogPath, "web-otel"],
    [join(squadStateDir, "logs", "daemon.otlp.jsonl"), "squad-daemon-otel"],
    [join(squadStateDir, "logs", "tray.otlp.jsonl"), "squad-tray-otel"],
  ];
  try {
    const entries = await readdir(runLogsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".log") || entry.name.endsWith(".otlp.jsonl"))) {
        candidates.push([join(runLogsDir, entry.name), "web-run"]);
      }
    }
  } catch {
    // Run logs are optional.
  }

  const batches = await Promise.all(candidates.map(([path, source]) => readRecentLogFile(path, source, cutoffMs)));
  return batches.flat().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-120);
}

async function collectFeedbackContext(route) {
  const runtime = getRuntime();
  const workspaces = await listWorkspaces().catch(() => []);
  const install = await readOptionalJsonFile(join(squadStateDir, "install.json"));
  const liveStatus = await readOptionalJsonFile(liveStatusPath);
  const logs = await collectRecentFeedbackLogs();
  const folderNames = Array.from(
    new Set(
      workspaces
        .map((workspace) => folderNameOnly(workspace.path || workspace.name || workspace.label))
        .filter(Boolean)
    )
  ).slice(0, 24);

  return {
    route: normalizeFeedbackRoute(route),
    squadVersion: packageMetadata.version || "0.0.0",
    installedVersion: sanitizeFeedbackText(install?.version || "", 120),
    autohandVersion: sanitizeFeedbackText(runtime.version || "", 200),
    platform: `${osPlatform()}-${arch()}`,
    osVersion: osRelease(),
    folderNames,
    logs,
    logCount: logs.length,
    generatedAt: new Date().toISOString(),
    liveStatus: liveStatus
      ? {
          onlineMembers: safeCount(liveStatus.onlineMembers),
          workingAgents: safeCount(liveStatus.workingAgents),
          activeWork: safeCount(liveStatus.activeWork),
          queuedJobs: safeCount(liveStatus.queuedJobs),
        }
      : null,
  };
}

function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.AUTOHAND_SQUAD_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    commandOutput("which", ["google-chrome"]),
    commandOutput("which", ["chromium"]),
    commandOutput("which", ["chromium-browser"]),
  ].filter(Boolean);
}

function findChromiumBinary() {
  return chromeCandidates().find((candidate) => existsSync(candidate)) || "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChromeDevtools(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not expose a DevTools endpoint")), 7000);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Chromium exited before screenshot capture"));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function pageWebSocketUrl(browserWsUrl) {
  const browserUrl = new URL(browserWsUrl);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://${browserUrl.host}/json`);
    const pages = await response.json();
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
    await delay(100);
  }
  throw new Error("Chromium page target was not available");
}

async function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chromium DevTools connection timed out")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chromium DevTools connection failed"));
    }, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || "DevTools command failed"));
      else resolve(message.result || {});
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params || {});
    }
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 7000);
    });
  }

  function waitForEvent(method, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const current = listeners.get(method) || new Set();
      const listener = (params) => {
        current.delete(listener);
        resolve(params);
      };
      current.add(listener);
      listeners.set(method, current);
      setTimeout(() => {
        current.delete(listener);
        resolve(null);
      }, timeoutMs);
    });
  }

  return {
    send,
    waitForEvent,
    close() {
      socket.close();
    },
  };
}

async function cdpNavigate(cdp, url) {
  const load = cdp.waitForEvent("Page.loadEventFired", 6000);
  await cdp.send("Page.navigate", { url });
  await load;
  await delay(500);
}

function storageEntriesForScreenshot(storage = {}) {
  return Object.entries(storage)
    .filter(([key, value]) => typeof key === "string" && typeof value === "string")
    .map(([key, value]) => [key.slice(0, 160), value.slice(0, 750000)])
    .slice(0, 20);
}

async function captureFeedbackScreenshot({ route, storage }) {
  const chrome = findChromiumBinary();
  if (!chrome) {
    return { available: false, error: "Chromium was not found on this machine." };
  }

  const profileDir = await mkdtemp(join(tmpdir(), "autohand-squad-shot-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--window-size=1440,1100",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try {
    const browserWsUrl = await waitForChromeDevtools(child);
    const wsUrl = await pageWebSocketUrl(browserWsUrl);
    const cdp = await createCdpClient(wsUrl);
    const baseUrl = `http://${host}:${port}`;
    const targetRoute = normalizeFeedbackRoute(route);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdpNavigate(cdp, baseUrl);
    const entries = storageEntriesForScreenshot(storage);
    await cdp.send("Runtime.evaluate", {
      expression: `for (const [key, value] of ${JSON.stringify(entries)}) { localStorage.setItem(key, value); }`,
    });
    await cdpNavigate(cdp, `${baseUrl}${targetRoute}`);
    const result = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    cdp.close();
    const size = Buffer.byteLength(result.data || "", "base64");
    return {
      available: Boolean(result.data),
      mimeType: "image/png",
      data: result.data || "",
      size,
      width: 1440,
      height: 1100,
      route: targetRoute,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    child.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizeScreenshotForSubmit(screenshot) {
  if (!screenshot?.data || screenshot.available === false) return null;
  const data = String(screenshot.data || "");
  return {
    mimeType: screenshot.mimeType || "image/png",
    data: data.slice(0, 10 * 1024 * 1024),
    size: Number(screenshot.size) || Buffer.byteLength(data, "base64"),
    width: Number(screenshot.width) || null,
    height: Number(screenshot.height) || null,
  };
}

async function submitSquadFeedback(input = {}) {
  const id = String(input.id || randomUUID());
  const kind = normalizeFeedbackKind(input.kind);
  const route = normalizeFeedbackRoute(input.route);
  const context = input.includeDiagnostics === false ? null : await collectFeedbackContext(route);
  const screenshot = input.includeScreenshot === false ? null : normalizeScreenshotForSubmit(input.screenshot);
  const deviceId = await ensureFeedbackDeviceId();
  const runtime = getRuntime();
  const payload = {
    id,
    kind,
    rating: input.rating ? Number(input.rating) : null,
    description: sanitizeFeedbackText(input.description, 10000),
    // The address is transmitted only when the user opted into contact.
    userEmail: input.allowContact ? String(input.userEmail || "").trim().slice(0, 320) : "",
    allowContact: Boolean(input.allowContact && input.userEmail),
    timestamp: new Date().toISOString(),
    deviceId,
    clientType: "squad",
    squadVersion: packageMetadata.version || "0.0.0",
    platform: `${osPlatform()}-${arch()}`,
    osVersion: osRelease(),
    route,
    folderNames: context?.folderNames || [],
    logs: context?.logs || [],
    screenshot,
    context: {
      ...context,
      runtimeAvailable: runtime.available,
      autohandPath: runtime.autohandPath ? "[PATH_REDACTED]" : "",
      serverStartedAt,
    },
  };

  await mkdir(feedbackBackupDir, { recursive: true });
  await writeFile(join(feedbackBackupDir, `${id}.json`), `${JSON.stringify({ ...payload, screenshot: screenshot ? { ...screenshot, data: "[base64 omitted]" } : null }, null, 2)}\n`, "utf8");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${feedbackApiBaseUrl}/v1/feedback/squad`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Type": "squad",
        "X-Client-Version": packageMetadata.version || "0.0.0",
        "X-Device-ID": deviceId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const apiPayload = await response.json().catch(() => ({}));
    if (!response.ok || apiPayload.success === false) {
      throw new Error(apiPayload.error || `Feedback API returned HTTP ${response.status}`);
    }
    return { id: apiPayload.id || id, storedLocally: true, sent: true };
  } finally {
    clearTimeout(timeout);
  }
}

const memoryScopes = new Set(["personal", "project", "team"]);
const memoryStatuses = new Set(["pending", "accepted", "rejected"]);
const memorySourceTypes = new Set(["conversation", "task", "run", "system"]);

function normalizeMemoryScope(scope) {
  return memoryScopes.has(scope) ? scope : "personal";
}

function normalizeMemoryStatus(status) {
  return memoryStatuses.has(status) ? status : "pending";
}

function normalizeMemoryConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
}

function normalizeMemoryProjectIdentity(item = {}) {
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const rawKey = String(
    item.projectKey ||
      item.projectWorkspace ||
      item.workspace ||
      source.projectKey ||
      source.projectWorkspace ||
      source.workspace ||
      ""
  ).trim();
  const projectKey = rawKey ? normalizeSquadWorkspacePath(rawKey) : "";
  return {
    projectKey,
    projectLabel: String(item.projectLabel || source.projectLabel || basename(projectKey) || projectKey || "").trim(),
  };
}

function normalizeMemoryRecord(item) {
  if (!item || typeof item !== "object") return null;
  const content = String(item.content || item.editedContent || item.proposedContent || "").trim();
  if (!content) return null;
  const createdAt = String(item.createdAt || item.proposedAt || new Date().toISOString());
  const scope = normalizeMemoryScope(item.scope);
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const project = normalizeMemoryProjectIdentity(item);
  return {
    id: String(item.id || randomUUID()),
    agentId: sanitizeAgentId(item.agentId || item.ownerAgentId || "default"),
    ownerAgentId: sanitizeAgentId(item.ownerAgentId || item.agentId || "default"),
    status: normalizeMemoryStatus(item.status),
    scope,
    projectKey: scope === "project" ? project.projectKey : String(item.projectKey || "").trim(),
    projectLabel: scope === "project" ? project.projectLabel : String(item.projectLabel || "").trim(),
    content,
    originalContent: String(item.originalContent || item.proposedContent || content).trim(),
    confidence: normalizeMemoryConfidence(item.confidence),
    confidenceRationale: String(item.confidenceRationale || item.rationale || "").trim(),
    source: {
      type: memorySourceTypes.has(source.type) ? source.type : "conversation",
      id: String(source.id || ""),
      label: String(source.label || source.id || "Source"),
      agentId: sanitizeAgentId(source.agentId || item.ownerAgentId || item.agentId || "default"),
    },
    evidence: String(item.evidence || item.supportingEvidence || "").trim(),
    rejectReason: String(item.rejectReason || "").trim(),
    editHistory: Array.isArray(item.editHistory) ? item.editHistory : [],
    isHidden: item.isHidden === true,
    acceptedAt: String(item.acceptedAt || ""),
    rejectedAt: String(item.rejectedAt || ""),
    createdAt,
    updatedAt: String(item.updatedAt || item.acceptedAt || item.rejectedAt || createdAt),
  };
}

function buildMemoryProjectIndex(items) {
  const projectIndex = {};
  for (const item of items) {
    if (item.scope !== "project" || !item.projectKey) continue;
    const record = projectIndex[item.projectKey] || {
      projectKey: item.projectKey,
      projectLabel: item.projectLabel || basename(item.projectKey),
      itemIds: [],
      pendingItemIds: [],
      acceptedItemIds: [],
      rejectedItemIds: [],
    };
    record.itemIds.push(item.id);
    if (item.status === "pending") record.pendingItemIds.push(item.id);
    if (item.status === "accepted") record.acceptedItemIds.push(item.id);
    if (item.status === "rejected") record.rejectedItemIds.push(item.id);
    projectIndex[item.projectKey] = record;
  }
  return projectIndex;
}

function normalizeMemoryInboxState(input = {}) {
  const rawItems = Array.isArray(input) ? input : Array.isArray(input.items) ? input.items : [];
  const items = rawItems.map(normalizeMemoryRecord).filter(Boolean);
  const updatedAt = new Date().toISOString();
  return {
    version: 1,
    storage: "local-squad-state",
    path: memoryInboxPath,
    updatedAt,
    items,
    projectIndex: buildMemoryProjectIndex(items),
  };
}

async function readMemoryInboxState() {
  const saved = await readOptionalJsonFile(memoryInboxPath);
  return normalizeMemoryInboxState(saved || {});
}

async function writeMemoryInboxState(input) {
  const state = normalizeMemoryInboxState(input);
  await mkdir(squadStateDir, { recursive: true });
  await writeFile(memoryInboxPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

// Squad channels: channel-level coordination with public/private visibility,
// per-channel membership, and threaded one-prompt dispatch. State lives in the
// shared squad state dir so the daemon can surface the same channels.json in
// queue/run telemetry after web reloads or daemon restarts.
// History mirrors contain many messages, unlike an individual channel edit.
const CHANNEL_HISTORY_MAX_BYTES = 16 * 1024 * 1024;
function normalizeChannelVisibility(value) {
  return value === "private" ? "private" : "public";
}

function normalizeChannelMemberIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((id) => String(id || "").trim()).filter(Boolean)));
}

function normalizeChannel(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "").trim();
  if (!name) return null;
  const createdAt = String(item.createdAt || new Date().toISOString());
  return {
    id: String(item.id || `channel-${randomUUID()}`),
    name: name.slice(0, 80),
    visibility: normalizeChannelVisibility(item.visibility),
    memberIds: normalizeChannelMemberIds(item.memberIds),
    projects: Array.isArray(item.projects) ? item.projects.filter(project => project && String(project.path || "").trim()).map(project => ({ ...project, name: String(project.name || basename(project.path)), path: String(project.path).trim() })) : [],
    section: String(item.section || "").trim(),
    creatorId: String(item.creatorId || "").trim(),
    // Self-judge / auto-mode execution control is opt-in per channel and
    // always defaults OFF; only an explicit true enables it.
    autoModeDefault: item.autoModeDefault === true,
    // Who answers un-mentioned messages (ADR-0108): everyone, a lead, or auto.
    responder: normalizeResponder(item.responder),
    replyMode: normalizeChannelReplyMode(item.replyMode),
    // Owned by the git route plug-in (docs/integration/git.md); kept verbatim so
    // the web app's own PUT /api/channels mirror does not erase the binding.
    git: item.git && typeof item.git === "object" ? item.git : undefined,
    events: Array.isArray(item.events) ? item.events : undefined,
    createdAt,
    updatedAt: String(item.updatedAt || createdAt),
  };
}

function normalizeChannelThread(item) {
  if (!item || typeof item !== "object") return null;
  const channelId = String(item.channelId || "").trim();
  if (!channelId) return null;
  const createdAt = String(item.createdAt || new Date().toISOString());
  const replyCount = Number(item.replyCount);
  return {
    id: String(item.id || item.threadId || `thread-${randomUUID()}`),
    channelId,
    parentMessageId: String(item.parentMessageId || "").trim(),
    title: String(item.title || item.prompt || "").trim().slice(0, 200),
    creatorId: String(item.creatorId || "").trim(),
    memberIds: normalizeChannelMemberIds(item.memberIds),
    autoMode: item.autoMode === true,
    selfJudge: item.selfJudge === true,
    replyCount: Number.isFinite(replyCount) && replyCount > 0 ? Math.floor(replyCount) : 0,
    createdAt,
    updatedAt: String(item.updatedAt || createdAt),
  };
}

function normalizeChannelMessage(item, fallbackChannelId = "") {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const channelId = String(item.channelId || fallbackChannelId || "").trim();
  if (!id || !channelId) return null;
  const createdAt = String(item.createdAt || item.startedAt || new Date().toISOString());
  const role = ["agent", "system", "user"].includes(String(item.role || "")) ? String(item.role) : "agent";
  const durationMs = Number(item.durationMs);
  return {
    ...item,
    id,
    channelId,
    channelName: String(item.channelName || "").trim(),
    role,
    agentId: String(item.agentId || "").trim(),
    body: String(item.body || item.content || item.reply || ""),
    status: String(item.status || "complete").trim() || "complete",
    time: String(item.time || "").trim(),
    threadId: String(item.threadId || "").trim(),
    parentMessageId: String(item.parentMessageId || "").trim(),
    workspace: String(item.workspace || "").trim(),
    transport: String(item.transport || "").trim(),
    command: String(item.command || "").trim(),
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    createdAt,
    updatedAt: String(item.updatedAt || item.completedAt || createdAt),
  };
}

function normalizeChannelMessages(input) {
  if (!input || typeof input !== "object") return [];
  const entries = Array.isArray(input) ? [["", input]] : Object.entries(input);
  const messages = [];
  for (const [channelId, records] of entries) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      const message = normalizeChannelMessage(record, channelId);
      if (message) messages.push(message);
    }
  }
  return messages;
}

// Migration-safe: accepts the current { channels, threads } document, a legacy
// bare array of channels, or nothing at all.
function normalizeChannelsState(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawChannels = Array.isArray(input) ? input : Array.isArray(source.channels) ? source.channels : [];
  const channels = rawChannels.map(normalizeChannel).filter(Boolean);
  const channelIds = new Set(channels.map((channel) => channel.id));
  const rawThreads = Array.isArray(source.threads) ? source.threads : [];
  const threads = rawThreads.map(normalizeChannelThread).filter((thread) => thread && channelIds.has(thread.channelId));
  const messages = normalizeChannelMessages(source.messages).filter((message) => channelIds.has(message.channelId));
  return {
    version: 1,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    deletedChannelIds: normalizeChannelMemberIds(source.deletedChannelIds),
    agentChannelAccess: source.agentChannelAccess && typeof source.agentChannelAccess === "object" && !Array.isArray(source.agentChannelAccess) ? source.agentChannelAccess : {},
    agentChannelActions: Array.isArray(source.agentChannelActions) ? source.agentChannelActions : [],
    storage: "local-squad-state",
    path: channelsStatePath,
    updatedAt: String(source.updatedAt || new Date().toISOString()),
    channels,
    threads,
    messages,
  };
}

const channelsStore = createChannelsStore({ filename: channelsStatePath, normalize: normalizeChannelsState, changed: () => emitBridgeEvent("channels.changed", { source: "bridge" }) });
const readChannelsState = () => channelsStore.read();
const writeChannelsState = input => channelsStore.replace(input);
// Auto responder picks use the workspace default provider (no member
// override) and only when it can be called directly (ADR-0108).
const responderPicker = createResponderPicker({
  resolveProvider: () => resolveProviderForAgent(null),
  autohandBaseUrl: AUTOHAND_AI_DEFAULT_BASE_URL,
  log: (entry) => console.log(`responders: pick ${JSON.stringify(entry)}`),
});

// Roster for a pick: the caller's member copies (name, role, purpose) win,
// the bridge's own member copies fill gaps, bare ids are the floor.
function responderRoster(channel, state, members = []) {
  const supplied = new Map((Array.isArray(members) ? members : []).filter((member) => member && member.id).map((member) => [String(member.id), member]));
  return channel.memberIds.map((memberId) => {
    const given = supplied.get(memberId);
    const known = state.agentChannelAccess?.[memberId]?.agent;
    return {
      id: memberId,
      name: String(given?.name || known?.name || memberId).slice(0, 80),
      role: String(given?.role || known?.role || "").slice(0, 80),
      purpose: String(given?.purpose || given?.description || known?.description || "").slice(0, 240),
    };
  });
}

function responderRecentLines(channel, state, limit = 6) {
  return state.messages
    .filter((message) => message.channelId === channel.id && message.body)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-limit)
    .map((message) => `${message.role === "user" ? message.authorName || "User" : state.agentChannelAccess?.[message.agentId]?.agent?.name || message.authorName || message.agentId || "Member"}: ${String(message.body).slice(0, 240)}`);
}
const mutateChannelsState = operation => channelsStore.mutate(operation);
const agentChannelActions = createAgentChannelActions({
  store: channelsStore, availability: memberAvailability, sanitizeId: sanitizeAgentId,
  run: payload => chatOnce(payload),
  reportError: error => console.error("Member/channel operation:", error.message),
  onProfileChanged: syncSavedMemberProfile,
  onRename: (memberId, { from, to }) => team.renamed(memberId, from, { name: to, role: "" }),
});

/**
 * The member's saved profile.json and IDENTITY.md take a rename now, not at
 * the member's next run: until then a bridge turn started from the saved
 * profile (withSavedMember, the agenda) still called the member by its old
 * name. Also run once at start for members renamed before this.
 */
async function syncSavedMemberProfile(memberId) {
  // In line with ensureAgentRuntime's writes to the same files.
  const id = sanitizeAgentId(memberId);
  const pending = (agentRuntimeWrites.get(id) || Promise.resolve()).catch(() => {}).then(() => writeSavedMemberProfile(id));
  agentRuntimeWrites.set(id, pending);
  try { return await pending; }
  finally { if (agentRuntimeWrites.get(id) === pending) agentRuntimeWrites.delete(id); }
}
async function writeSavedMemberProfile(id) {
  const agentHome = join(isolatedAgentsDir, id);
  const profilePath = join(agentHome, "profile.json");
  const saved = await readPersistentJson(profilePath, null);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
  const access = await agentChannelActions.memberAccess(id);
  if (!access?.agent || access.removed) return;
  const fields = Object.fromEntries(MEMBER_PROFILE_FIELDS.filter(key => key in access.agent).map(key => [key, access.agent[key]]));
  const next = { ...saved, ...fields, profileRevision: memberProfileRevision(access.agent), updatedAt: access.updatedAt };
  const skills = { ...(saved.skillInstall || {}), requested: next.skills || [] };
  const files = (next.profileFiles || []).map(file => {
    if (file.section !== "identity") return file;
    let content = String(file.content || "");
    for (const [label, value] of [["Name", next.name], ["Role", next.role]]) content = content.replace(new RegExp(`^${label}: .*$`, "m"), () => `${label}: ${String(value || "").replace(/\s+/g, " ")}`);
    return { ...file, content };
  });
  const plan = planAgentProfileDocs({ ...next, profileFiles: files }, agentHome, id, next.workspace || "", skills);
  await writeAgentProfileDocs(plan);
  await writePersistentJson(profilePath, { ...next, profileDocs: plan.profileDocs });
}
void readChannelsState().then(async (state) => {
  for (const [id, access] of Object.entries(state?.agentChannelAccess || {})) {
    if (!access?.removed && access?.agent?.name && !isUtilityAgent(id)) await syncSavedMemberProfile(id).catch(error => console.error("Member profile projection:", error.message));
  }
}).catch(() => {});

async function createChannel(payload) {
  const channel = normalizeChannel({
    ...payload,
    id: payload?.id || `channel-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  });
  if (!channel) throw new Error("channel name is required");
  return mutateChannelsState(state => {
    const sameId = state.channels.find(item => item.id === channel.id);
    if (sameId) {
      if (sameId.name.toLowerCase() === channel.name.toLowerCase()) return sameId;
      throw channelError(`channel ${channel.id} already exists`, 409);
    }
    if (state.deletedChannelIds.includes(channel.id)) throw channelError('This channel was deleted. Create a new channel instead.', 409);
    if (state.channels.some(item => item.name.toLowerCase() === channel.name.toLowerCase())) throw channelError(`A channel named ${channel.name} already exists. Open it or choose another name.`, 409);
    state.channels.push(channel);
    return channel;
  });
}

async function updateChannel(channelId, patch) {
  return mutateChannelsState(state => {
  const existing = state.channels.find((item) => item.id === channelId);
  if (!existing) throw new Error("channel not found");
  const source = patch && typeof patch === "object" ? patch : {};
  const next = normalizeChannel({
    ...existing,
    ...(typeof source.name === "string" && source.name.trim() ? { name: source.name } : {}),
    ...(source.visibility !== undefined ? { visibility: source.visibility } : {}),
    ...(Array.isArray(source.memberIds) ? { memberIds: source.memberIds } : {}),
    ...(Array.isArray(source.projects) ? { projects: source.projects } : {}),
    ...(typeof source.section === "string" ? { section: source.section } : {}),
    ...(source.git !== undefined ? { git: source.git } : {}),
    ...(Array.isArray(source.events) ? { events: source.events } : {}),
    ...(source.autoModeDefault !== undefined ? { autoModeDefault: source.autoModeDefault === true } : {}),
    ...(source.responder !== undefined ? { responder: normalizeResponder(source.responder) } : {}),
    ...(source.replyMode !== undefined ? { replyMode: normalizeChannelReplyMode(source.replyMode) } : {}),
    id: existing.id,
    creatorId: existing.creatorId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  if (state.channels.some(item => item.id !== channelId && item.name.toLowerCase() === next.name.toLowerCase())) throw channelError(`A channel named ${next.name} already exists.`, 409);
  // A lead must be on the roster when it is chosen; a lead that leaves later
  // is kept and reported as missing, so the row can say why everyone answers.
  if (source.responder !== undefined && next.responder.mode === "lead" && !next.responder.leadMemberId) throw channelError("Choose a lead from the channel members.");
  if (source.responder !== undefined && next.responder.leadMemberId && !next.memberIds.includes(next.responder.leadMemberId)) throw channelError("The lead must be a member of this channel.");
  state.channels = state.channels.map((item) => (item.id === channelId ? next : item));
  return next;
  });
}

async function deleteChannel(channelId) {
  return mutateChannelsState(state => {
  const existing = state.channels.find((item) => item.id === channelId);
  if (!existing) throw new Error("channel not found");
  state.channels = state.channels.filter((item) => item.id !== channelId);
  state.threads = state.threads.filter((item) => item.channelId !== channelId);
  state.messages = state.messages.filter((item) => item.channelId !== channelId);
  state.deletedChannelIds.push(channelId);
  return existing;
  });
}

async function updateChannelMembers(channelId, payload) {
  return mutateChannelsState(state => {
  const existing = state.channels.find((item) => item.id === channelId);
  if (!existing) throw new Error("channel not found");
  const add = normalizeChannelMemberIds(payload?.add);
  const remove = new Set(normalizeChannelMemberIds(payload?.remove));
  const memberIds = Array.isArray(payload?.memberIds)
    ? normalizeChannelMemberIds(payload.memberIds)
    : normalizeChannelMemberIds(existing.memberIds.concat(add)).filter(id => !remove.has(id));
  const next = { ...existing, memberIds, updatedAt: new Date().toISOString() };
  state.channels = state.channels.map((item) => (item.id === channelId ? next : item));
  return next;
  });
}

async function recordChannelThread(channelId, payload) {
  return mutateChannelsState(state => {
  const channel = state.channels.find((item) => item.id === channelId);
  if (!channel) throw new Error("channel not found");
  const thread = normalizeChannelThread({ ...payload, channelId });
  if (!thread) throw new Error("thread could not be recorded");
  const index = state.threads.findIndex((item) => item.id === thread.id);
  if (index === -1) {
    state.threads.push(thread);
  } else {
    state.threads[index] = { ...state.threads[index], ...thread, updatedAt: new Date().toISOString() };
  }
  channel.updatedAt = new Date().toISOString();
  return thread;
  });
}

// Extract the channel/thread contract from a chat or run payload. The payload
// can carry channelId, threadId, parentMessageId, visibility, memberIds,
// autoModeDefault, and selfJudge intent either at the top level or under a
// `channel` object; absent fields fall back to safe defaults (auto mode OFF).
function channelContextFromPayload(payload) {
  const nested = payload?.channel && typeof payload.channel === "object" ? payload.channel : {};
  const channelId = String(payload?.channelId || nested.channelId || nested.id || "").trim();
  if (!channelId) return null;
  const runtime = payload?.collaboration?.runtime && typeof payload.collaboration.runtime === "object"
    ? payload.collaboration.runtime
    : {};
  return {
    channelId,
    threadId: String(payload?.threadId || nested.threadId || "").trim(),
    parentMessageId: String(payload?.parentMessageId || nested.parentMessageId || "").trim(),
    visibility: normalizeChannelVisibility(payload?.visibility || nested.visibility),
    memberIds: normalizeChannelMemberIds(payload?.memberIds || nested.memberIds),
    autoModeDefault: payload?.autoModeDefault === true || nested.autoModeDefault === true || runtime.autoMode === true,
    selfJudge: payload?.selfJudge === true || nested.selfJudge === true || runtime.selfJudge === true,
    channelName: String(nested.name || nested.channelName || payload?.channelName || "").trim(),
  };
}

// Best-effort thread bookkeeping when a channel prompt or in-thread reply is
// dispatched; never blocks or fails the chat/run itself.
async function recordChannelDispatch(channelContext, { prompt = "", agentId = "" } = {}) {
  if (!channelContext?.channelId || !channelContext.threadId) return;
  try {
    await mutateChannelsState(state => {
    const channel = state.channels.find((item) => item.id === channelContext.channelId);
    if (!channel) return;
    const existing = state.threads.find((item) => item.id === channelContext.threadId);
    if (existing) {
      existing.replyCount += 1;
      existing.updatedAt = new Date().toISOString();
    } else {
      state.threads.push(
        normalizeChannelThread({
          id: channelContext.threadId,
          channelId: channelContext.channelId,
          parentMessageId: channelContext.parentMessageId,
          title: prompt,
          creatorId: agentId,
          memberIds: channelContext.memberIds,
          autoMode: channelContext.autoModeDefault,
          selfJudge: channelContext.selfJudge,
        })
      );
    }
    channel.updatedAt = new Date().toISOString();
    });
  } catch {
    // Channel bookkeeping is telemetry-grade; dispatch must not fail on it.
  }
}

async function readOptionalJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const values = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readOptionalJsonFile(join(dir, entry.name)))
    );
    return values.filter(Boolean);
  } catch {
    return [];
  }
}

async function readJsonLines(path) {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeJsonParse(line))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function appendTelemetryEvent(event, metadata = {}) {
  const record = {
    event: String(event || "usage.recorded"),
    timestamp: new Date().toISOString(),
    clientType: "squad",
    surface: "squad-web",
    version: packageMetadata.version || "web-prototype",
    metadata,
  };
  await mkdir(squadStateDir, { recursive: true });
  await appendFile(join(squadStateDir, "telemetry.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  // telemetry.jsonl keeps its analytics contract; the same event is also a
  // structured log record so OTLP consumers see it.
  logEvent(SEVERITY.INFO, record.event, { "event.name": record.event, "event.domain": "autohand.squad", ...flattenAttributes(metadata) });
}

function flattenAttributes(value, prefix = "", output = {}, depth = 0) {
  if (!value || typeof value !== "object" || depth > 3) return output;
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) flattenAttributes(item, name, output, depth + 1);
    else if (item !== undefined && item !== null) output[name] = Array.isArray(item) ? item.map(String).join(",") : item;
  }
  return output;
}

function valueField(value, fields) {
  for (const field of fields) {
    const next = value?.[field];
    if (typeof next === "string" && next.trim()) return next;
  }
  return null;
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function numericField(source, fields) {
  for (const field of fields) {
    const value = source?.[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    }
  }
  return 0;
}

function nestedStringField(source, paths) {
  for (const path of paths) {
    let current = source;
    for (const key of path) current = current?.[key];
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return "";
}

function nestedNumericField(source, paths) {
  for (const path of paths) {
    let current = source;
    for (const key of path) current = current?.[key];
    const value = numericField({ value: current }, ["value"]);
    if (value > 0) return value;
  }
  return 0;
}

function timestampMillis(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^unix-ms:\d+$/.test(text)) return Number(text.slice("unix-ms:".length));
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function durationBetween(startedAt, finishedAt) {
  const started = timestampMillis(startedAt);
  const finished = timestampMillis(finishedAt);
  return started && finished && finished >= started ? finished - started : 0;
}

function harnessFromCommand(command) {
  const lower = String(command || "").toLowerCase();
  if (lower.includes("autohand")) return "autohand-cli";
  if (lower.includes("codex")) return "codex-cli";
  if (lower.includes("claude")) return "claude-code-cli";
  return "";
}

function normalizeEffectiveModel(value) {
  if (!value || typeof value !== "object") return {};
  return {
    provider: String(value.provider || "").trim(),
    model: String(value.model || "").trim(),
  };
}

function usageRecordFromEvent(event) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const eventName = String(event?.event || "");
  const inputTokens =
    numericField(metadata, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]) ||
    nestedNumericField(metadata, [["usage", "inputTokens"], ["usage", "input_tokens"], ["usage", "promptTokens"], ["usage", "prompt_tokens"]]);
  const outputTokens =
    numericField(metadata, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]) ||
    nestedNumericField(metadata, [["usage", "outputTokens"], ["usage", "output_tokens"], ["usage", "completionTokens"], ["usage", "completion_tokens"]]);
  const tokens =
    numericField(metadata, ["tokens", "totalTokens", "total_tokens"]) ||
    nestedNumericField(metadata, [["usage", "tokens"], ["usage", "totalTokens"], ["usage", "total_tokens"]]) ||
    inputTokens + outputTokens;
  const durationMs = numericField(metadata, ["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]);
  const steps = numericField(metadata, ["steps", "stepCount", "step_count", "toolCalls", "tool_calls"]);
  const runId = String(metadata.runId || metadata.run_id || "").trim();
  const provider = String(metadata.provider || nestedStringField(metadata, [["effectiveModel", "provider"], ["model", "provider"]]) || "").trim();
  const model = String(metadata.model || nestedStringField(metadata, [["effectiveModel", "model"], ["model", "model"]]) || "").trim();
  const harness = String(metadata.harness || metadata.transport || event?.surface || event?.clientType || event?.client_type || "telemetry").trim();
  const hasUsageSignal =
    tokens > 0 ||
    inputTokens > 0 ||
    outputTokens > 0 ||
    durationMs > 0 ||
    provider ||
    model ||
    eventName.includes("usage") ||
    eventName.includes("chat") ||
    eventName.startsWith("launcher.");
  if (!hasUsageSignal) return null;
  return {
    at: event?.timestamp || null,
    source: eventName || "telemetry",
    harness,
    runId: runId || null,
    agentId: metadata.agentId || metadata.agent_id || null,
    provider: provider || null,
    model: model || null,
    tokens,
    inputTokens,
    outputTokens,
    durationMs,
    // Steps are known only when the harness reported them (ADR-0091).
    steps: "steps" in metadata || "stepCount" in metadata || "toolCalls" in metadata ? steps : null,
    status: metadata.status || eventName || null,
  };
}

function usageRecordFromRun(run) {
  if (!run || typeof run !== "object") return null;
  const effectiveModel = normalizeEffectiveModel(run.effectiveModel || run.effective_model);
  const startedAt = run.startedAt || run.started_at || run.createdAt || run.created_at || null;
  const finishedAt = run.finishedAt || run.finished_at || run.completedAt || run.completed_at || null;
  const status = run.status || null;
  if (!startedAt && !finishedAt && !status) return null;
  const inputTokens = numericField(run, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const outputTokens = numericField(run, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  const traceSteps = Array.isArray(run.trace?.toolCalls) ? run.trace.toolCalls.length : Array.isArray(run.trace?.steps) ? run.trace.steps.length : null;
  const steps = numericField(run, ["steps", "stepCount", "step_count"]) || traceSteps;
  return {
    at: finishedAt || startedAt,
    source: "run",
    harness: run.transport || run.harness || harnessFromCommand(run.command) || "autohand-cli",
    runId: run.id || run.runId || run.run_id || null,
    agentId: run.agentId || run.agent_id || null,
    provider: effectiveModel.provider || run.provider || null,
    model: effectiveModel.model || run.model || null,
    tokens: numericField(run, ["tokens", "totalTokens", "total_tokens"]) || inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    durationMs: numericField(run, ["durationMs", "duration_ms"]) || durationBetween(startedAt, finishedAt),
    steps: steps === null || steps === undefined ? null : steps,
    status,
  };
}

function usageBreakdown(records, labelFor) {
  const rows = new Map();
  for (const record of records) {
    const label = String(labelFor(record) || "").trim();
    if (!label) continue;
    const row = rows.get(label) || { label, count: 0, tokens: 0, durationMs: 0, lastAt: null };
    row.count += 1;
    row.tokens += Number(record.tokens) || 0;
    row.durationMs += Number(record.durationMs) || 0;
    if (!row.lastAt || String(record.at || "") > String(row.lastAt || "")) row.lastAt = record.at || null;
    rows.set(label, row);
  }
  return Array.from(rows.values())
    .sort((a, b) => b.count - a.count || b.tokens - a.tokens || b.durationMs - a.durationMs || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function usageSnapshot(runs, telemetry) {
  const records = [
    ...telemetry.map(usageRecordFromEvent).filter(Boolean),
    ...runs.map(usageRecordFromRun).filter(Boolean),
  ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const totalDurationMs = records.reduce((sum, record) => sum + (Number(record.durationMs) || 0), 0);
  const timedRecords = records.filter((record) => Number(record.durationMs) > 0).length;
  return {
    totalRecords: records.length,
    activeSessions: records.filter((record) => ["queued", "running", "launching"].includes(record.status)).length,
    totalTokens: records.reduce((sum, record) => sum + (Number(record.tokens) || 0), 0),
    inputTokens: records.reduce((sum, record) => sum + (Number(record.inputTokens) || 0), 0),
    outputTokens: records.reduce((sum, record) => sum + (Number(record.outputTokens) || 0), 0),
    totalDurationMs,
    averageDurationMs: timedRecords ? Math.round(totalDurationMs / timedRecords) : 0,
    lastUsageAt: records[0]?.at || null,
    topHarnesses: usageBreakdown(records, (record) => record.harness),
    topProviders: usageBreakdown(records, (record) => record.provider),
    topModels: usageBreakdown(records, (record) => record.model),
    recent: records.slice(0, 12),
  };
}

function usageMetadata({ payload = {}, agentRuntime = {}, transport = "", status = "completed", durationMs = 0, startedAt = "", completedAt = "", trace = null, command = "", runId = "" }) {
  const effectiveModel = normalizeEffectiveModel(agentRuntime.effectiveModel || payload.effectiveModel);
  const traceUsage = trace?.usage && typeof trace.usage === "object" ? trace.usage : {};
  const inputTokens = numericField(traceUsage, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const outputTokens = numericField(traceUsage, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  // Steps (tool calls) when the trace carries them; the usage ledger shows
  // "—" for records without them (ADR-0091).
  const steps = Array.isArray(trace?.toolCalls) ? trace.toolCalls.length : Array.isArray(trace?.steps) ? trace.steps.length : null;
  return {
    ...(runId ? { runId: String(runId) } : {}),
    ...(steps === null ? {} : { steps }),
    harness: transport || trace?.transport || harnessFromCommand(command || trace?.command) || "autohand-cli",
    transport: transport || trace?.transport || "",
    status,
    agentId: payload.agentId || agentRuntime.agentId || "",
    provider: effectiveModel.provider || "",
    model: effectiveModel.model || "",
    durationMs: Number(durationMs || trace?.durationMs || 0) || durationBetween(startedAt || trace?.startedAt, completedAt || trace?.completedAt),
    startedAt: startedAt || trace?.startedAt || "",
    completedAt: completedAt || trace?.completedAt || "",
    command: command || trace?.command || "",
    tokens: numericField(traceUsage, ["tokens", "totalTokens", "total_tokens"]) || inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    // Context read on the last request and the model window when the harness
    // reports one; the member context gauge is computed from these (ADR-0111).
    ...contextUsageFromUsage(traceUsage),
  };
}

function recordUsageTelemetry(event, metadata) {
  emitBridgeEvent(event, metadata);
  void appendTelemetryEvent(event, metadata).catch((error) => {
    console.warn(`usage telemetry failed: ${error.message}`);
  });
}

function pidRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function serviceRecord(record) {
  if (!record) return null;
  return {
    pid: record.pid,
    host: record.host,
    port: record.port,
    url: record.url,
    running: pidRunning(record.pid),
    startedAt: record.startedAt || record.started_at || null,
  };
}

async function fetchAnalyticsDaemonSnapshot() {
  const record = await readOptionalJsonFile(join(squadStateDir, "analytics.json"));
  if (!record?.host || !record?.port) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 650);
  try {
    const response = await fetch(`http://${record.host}:${record.port}/metrics`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// The usage ledger (ADR-0091) is computed by the bridge for both analytics
// paths: the installed app serves the analytics daemon's snapshot, which does
// not carry breakdowns, so the bridge attaches them from the same
// telemetry.jsonl and run records. The cache key is what those reads depend
// on, because the Usage page polls every second and telemetry.jsonl is large.
const usageLedgerCache = createUsageLedgerCache();

async function usageLedgerSignature() {
  let telemetryStat = "none";
  try {
    const info = await stat(join(squadStateDir, "telemetry.jsonl"));
    telemetryStat = `${info.size}:${info.mtimeMs}`;
  } catch {
    // no telemetry yet
  }
  let runFiles = 0;
  try {
    runFiles = (await readdir(join(squadStateDir, "runs"))).length;
  } catch {
    // no runs folder yet
  }
  const liveRuns = Array.from(runs.values()).map((run) => `${run.id}:${run.status}`).join(",");
  const liveStatusStat = await stat(liveStatusPath).then((info) => `${info.size}:${info.mtimeMs}`).catch(() => "none");
  return `${telemetryStat}|${runFiles}|${liveRuns}|${liveStatusStat}`;
}

function mergedRuns(diskRuns) {
  const runtimeRuns = Array.from(runs.values()).map(runSummary);
  const runMap = new Map();
  for (const run of [...diskRuns, ...runtimeRuns]) {
    if (run?.id) runMap.set(run.id, run);
  }
  return Array.from(runMap.values());
}

function usageRecordsFrom(allRuns, telemetry) {
  return [...telemetry.map(usageRecordFromEvent).filter(Boolean), ...allRuns.map(usageRecordFromRun).filter(Boolean)];
}

async function usageLedgerSnapshot(preloaded = null) {
  const signature = await usageLedgerSignature();
  return usageLedgerCache.get(signature, async () => {
    const [diskRuns, telemetry, liveStatus] = preloaded
      ? [preloaded.diskRuns, preloaded.telemetry, preloaded.liveStatus]
      : await Promise.all([
          readJsonDir(join(squadStateDir, "runs")),
          readJsonLines(join(squadStateDir, "telemetry.jsonl")),
          readOptionalJsonFile(liveStatusPath),
        ]);
    return usageLedger({ records: usageRecordsFrom(mergedRuns(diskRuns), telemetry), members: liveStatus?.members });
  });
}

async function analyticsSnapshot() {
  const daemonSnapshot = await fetchAnalyticsDaemonSnapshot();
  if (daemonSnapshot?.success) {
    const ledger = await usageLedgerSnapshot().catch(() => null);
    return ledger ? { ...daemonSnapshot, usage: { ...(daemonSnapshot.usage || {}), ...ledger } } : daemonSnapshot;
  }

  const [daemonRecord, analyticsRecord, webServerRecord, installRecord, updateRecord, queueItems, diskRuns, telemetry, liveStatus] =
    await Promise.all([
      readOptionalJsonFile(join(squadStateDir, "daemon.json")),
      readOptionalJsonFile(join(squadStateDir, "analytics.json")),
      readOptionalJsonFile(join(squadStateDir, "web-server.json")),
      readOptionalJsonFile(join(squadStateDir, "install.json")),
      readOptionalJsonFile(join(squadStateDir, "update.json")),
      readJsonDir(join(squadStateDir, "queue")),
      readJsonDir(join(squadStateDir, "runs")),
      readJsonLines(join(squadStateDir, "telemetry.jsonl")),
      readOptionalJsonFile(liveStatusPath),
    ]);

  const allRuns = mergedRuns(diskRuns);
  const ledger = await usageLedgerSnapshot({ diskRuns, telemetry, liveStatus }).catch(() => null);
  const usage = { ...usageSnapshot(allRuns, telemetry), ...(ledger || {}) };
  const activeRuns = allRuns.filter((run) => ["queued", "running"].includes(run.status));
  const failedRuns = allRuns.filter((run) => run.status === "failed");
  const completedRuns = allRuns.filter((run) => run.status === "completed");
  const rejectedRuns = allRuns.filter((run) => run.status === "rejected");
  const activeAgents = new Set(
    activeRuns
      .map((run) => run.agentId || run.agent_id)
      .filter((agentId) => typeof agentId === "string" && agentId.trim())
  );
  const completedOrFailed = completedRuns.length + failedRuns.length;
  const eventCounts = countBy(telemetry, (event) => event.event);
  const liveQueueDepth = safeCount(liveStatus?.queueDepth);
  const liveQueuedJobs = safeCount(liveStatus?.queuedJobs);
  const liveScheduledJobs = safeCount(liveStatus?.scheduledJobs);
  const liveActiveWork = safeCount(liveStatus?.activeWork);
  const liveOnlineMembers = safeCount(liveStatus?.onlineMembers);
  const liveWorkingAgents = safeCount(liveStatus?.workingAgents);
  const liveTotalRuns = safeCount(liveStatus?.totalRuns);
  const generatedAt = new Date().toISOString();
  const mainDaemon = serviceRecord(daemonRecord);
  const analyticsDaemon = serviceRecord(analyticsRecord);
  const recentErrors = [
    ...failedRuns.map((run) => ({
      at: run.finishedAt || run.completedAt || run.completed_at || run.startedAt || run.createdAt || null,
      source: "run",
      message: run.title || run.prompt || "run failed",
      runId: run.id,
    })),
    ...telemetry
      .filter((event) => String(event.event || "").includes("error") || event.metadata?.remoteError || event.metadata?.error)
      .map((event) => ({
        at: event.timestamp || null,
        source: event.surface || "telemetry",
        message: event.metadata?.remoteError || event.metadata?.error || event.event,
        runId: event.metadata?.runId || event.metadata?.run_id || null,
      })),
  ]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 8);

  return {
    success: true,
    generatedAt,
    source: "web-server-fallback",
    stateDir: squadStateDir,
    services: {
      activeDaemons: [mainDaemon, analyticsDaemon].filter((record) => record?.running).length,
      mainDaemon,
      analyticsDaemon,
      webServer: webServerRecord || null,
    },
    versions: {
      runtimeVersion: "web-prototype",
      installedVersion: installRecord?.version || null,
      installedChannel: installRecord?.channel || null,
      installedAt: installRecord?.installedAt || installRecord?.installed_at || null,
      updateChannel: updateRecord?.channel || null,
      latestAllowedVersion: updateRecord?.latestAllowedVersion || updateRecord?.latest_allowed_version || null,
      updateAvailable: typeof updateRecord?.updateAvailable === "boolean" ? updateRecord.updateAvailable : null,
    },
    work: {
      queueDepth: queueItems.length + liveQueueDepth,
      queuedJobs: queueItems.filter((item) => item.status === "queued").length + liveQueuedJobs,
      scheduledJobs: queueItems.filter((item) => item.scheduledFor || item.scheduled_for).length + liveScheduledJobs,
      activeWork: activeRuns.length + queueItems.filter((item) => ["queued", "running"].includes(item.status)).length + liveActiveWork,
      onlineMembers: Math.max(activeAgents.size, activeRuns.length, liveOnlineMembers),
      workingAgents: Math.max(activeAgents.size, activeRuns.length, liveWorkingAgents),
      totalRuns: allRuns.length + liveTotalRuns,
      runningRuns: activeRuns.length,
      completedRuns: completedRuns.length,
      failedRuns: failedRuns.length,
      rejectedRuns: rejectedRuns.length,
      queueVolume: queueItems.length + allRuns.length + liveQueueDepth + liveTotalRuns,
      failureRate: completedOrFailed ? failedRuns.length / completedOrFailed : 0,
    },
    telemetry: {
      totalEvents: telemetry.length,
      eventCounts,
      clientTypeCounts: countBy(telemetry, (event) => event.clientType || event.client_type),
      surfaceCounts: countBy(telemetry, (event) => event.surface),
      queueCreated: eventCounts["queue.created"] || 0,
      queueStarted: (eventCounts["queue.started"] || 0) + (eventCounts["active_work.started"] || 0),
      queueCompleted: eventCounts["queue.completed"] || 0,
      queueFailed: eventCounts["queue.failed"] || 0,
      errors: eventCounts.error || 0,
      lastEventAt: telemetry.at(-1)?.timestamp || null,
    },
    usage,
    timestamps: {
      lastDeviceRegistrationAt: valueField(await readOptionalJsonFile(join(squadStateDir, "device-registration.json")), ["registeredAt", "registered_at"]),
      lastPingAt: valueField(await readOptionalJsonFile(join(squadStateDir, "ping.json")), ["pingedAt", "pinged_at"]),
      lastFeatureFlagCheckAt: valueField(await readOptionalJsonFile(join(squadStateDir, "feature-flags.json")), ["checkedAt", "checked_at"]),
      lastTelemetryFlushAt: valueField(await readOptionalJsonFile(join(squadStateDir, "telemetry-flush.json")), ["flushedAt", "flushed_at"]),
      lastSyncAt: valueField(await readOptionalJsonFile(join(squadStateDir, "sync.json")), ["syncedAt", "synced_at"]),
      lastUpdateCheckAt: valueField(updateRecord, ["checkedAt", "checked_at"]),
      lastSnapshotAt: generatedAt,
      lastWebStatusAt: valueField(liveStatus, ["updatedAt", "updated_at"]),
    },
    recentErrors,
  };
}

function formatChatReply(stdout, stderr, prompt) {
  const promptText = String(prompt || "").trim();
  const lines = stripAnsi(stdout)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "autohand") return false;
      if (trimmed === promptText || trimmed === `> ${promptText}`) return false;
      if (trimmed === `› ${promptText}` || trimmed.replace(/^›\s*/, "") === promptText) return false;
      if (/^Completed in .* tokens? used$/i.test(trimmed)) return false;
      return true;
    });

  const reply = lines.join("\n").trim();
  if (reply) return reply;
  return stripAnsi(stderr).trim();
}

function visibleCliStreamOutput(chunk, prompt) {
  const promptText = String(prompt || "").trim();
  return stripAnsi(chunk)
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed === "autohand") return false;
      if (trimmed === promptText || trimmed === `> ${promptText}`) return false;
      if (trimmed === `› ${promptText}` || trimmed.replace(/^›\s*/, "") === promptText) return false;
      if (/^Completed in .* tokens? used$/i.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

function compactTraceText(value, maxLength = 50000) {
  const text = stripAnsi(value).trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[output truncated after ${maxLength} characters]`;
}

function normalizeToolCall(call, timestamp = "") {
  if (!call || typeof call !== "object") return null;
  const functionCall = call.function && typeof call.function === "object" ? call.function : null;
  const rawArgs = call.args ?? call.arguments ?? functionCall?.arguments ?? {};
  const parsedArgs = typeof rawArgs === "string" ? safeJsonParse(rawArgs) || rawArgs : rawArgs;
  const name = call.tool || call.name || functionCall?.name || call.type || "tool";

  return {
    id: String(call.id || call.tool_call_id || call.callId || ""),
    name: String(name || "tool"),
    args: parsedArgs,
    timestamp: call.timestamp || timestamp,
  };
}

function conversationTraceFromEntries(entries) {
  const thoughts = [];
  const toolCalls = [];
  const toolResults = [];
  const messages = [];
  const events = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const role = String(entry.role || "");
    const timestamp = entry.timestamp || entry.at || "";
    const content = typeof entry.content === "string" ? entry.content : "";
    const parsedContent = safeJsonParse(content.trim());

    if (role === "assistant") {
      const payload = parsedContent && typeof parsedContent === "object" ? parsedContent : null;
      if (payload?.thought || payload?.reflection) {
        const thoughtEvent = {
          thought: compactTraceText(payload.thought || "", 18000),
          reflection: compactTraceText(payload.reflection || "", 18000),
          timestamp,
        };
        thoughts.push(thoughtEvent);
        events.push({ type: "thought", ...thoughtEvent });
      }

      const nestedCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : [];
      const directCalls = Array.isArray(entry.toolCalls) ? entry.toolCalls : [];
      for (const call of [...nestedCalls, ...directCalls]) {
        const normalized = normalizeToolCall(call, timestamp);
        if (normalized) {
          toolCalls.push(normalized);
          events.push({ type: "tool_call", call: normalized, timestamp });
        }
      }

      const visibleText = payload?.answer || payload?.response || payload?.content || (!payload ? content : "");
      if (visibleText && typeof visibleText === "string") {
        const messageEvent = { role, content: compactTraceText(visibleText, 24000), timestamp };
        messages.push(messageEvent);
        events.push({ type: "assistant_event", ...messageEvent });
      }
    }

    if (role === "tool") {
      const toolResult = {
        id: String(entry.tool_call_id || entry.toolCallId || ""),
        name: String(entry.name || "tool"),
        content: compactTraceText(content, 24000),
        timestamp,
      };
      toolResults.push(toolResult);
      events.push({ type: "tool_result", result: toolResult, timestamp });
    }
  }

  return { thoughts, toolCalls, toolResults, messages, events };
}

async function latestConversationEntries(agentHome, startedAt) {
  const sessionsDir = join(agentHome, "sessions");
  let sessionDirs = [];
  try {
    sessionDirs = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  let latest = null;
  for (const dirent of sessionDirs) {
    if (!dirent.isDirectory()) continue;
    const conversationPath = join(sessionsDir, dirent.name, "conversation.jsonl");
    try {
      const info = await stat(conversationPath);
      if (info.mtimeMs < startedAt - 30000) continue;
      if (!latest || info.mtimeMs > latest.mtimeMs) {
        latest = { path: conversationPath, mtimeMs: info.mtimeMs };
      }
    } catch {
      // Some sessions have metadata only; skip them.
    }
  }

  if (!latest) return [];

  try {
    const content = await readFile(latest.path, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => safeJsonParse(line))
      .filter(Boolean)
      .slice(-160);
  } catch {
    return [];
  }
}

async function buildChatTrace({ agentHome, startedAt, stdout, stderr, prompt, command, exitCode }) {
  const entries = await latestConversationEntries(agentHome, startedAt);
  const transcript = conversationTraceFromEntries(entries);
  const promptText = String(prompt || "").trim();
  const steps = compactTraceText(stdout, 50000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-→>›\s]*step\s+\d+\s*:/i.test(line) && line !== promptText)
    .map((line) => {
      const match = line.match(/^[-→>›\s]*step\s+(\d+)\s*:\s*(.+)$/i);
      return {
        index: match ? Number(match[1]) : null,
        title: match ? match[2].trim() : line,
      };
    });

  return {
    command,
    exitCode,
    steps,
    thoughts: transcript.thoughts,
    toolCalls: transcript.toolCalls,
    toolResults: transcript.toolResults,
    messages: transcript.messages,
    events: [
      ...steps.map((step) => ({ type: "step", ...step })),
      ...transcript.events,
    ],
    raw: {
      stdout: compactTraceText(stdout),
      stderr: compactTraceText(stderr),
    },
  };
}

function compactJson(value, maxLength = 12000) {
  try {
    return compactTraceText(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return compactTraceText(String(value), maxLength);
  }
}

function sdkEventTimestamp(event) {
  return event?.timestamp || new Date().toISOString();
}

function appendSdkEventLog(run, event) {
  if (!event || typeof event !== "object") return;
  const timestamp = sdkEventTimestamp(event);
  if (event.type === "message_update" && event.delta) {
    appendLog(run, "stdout", event.delta);
    return;
  }
  if (event.type === "message_end" && event.content) {
    appendLog(run, "stdout", event.content);
    return;
  }
  if (event.type === "tool_start") {
    appendLog(run, "tool", `started ${event.toolName || "tool"} ${compactJson(event.args || {}, 4000)}`);
    return;
  }
  if (event.type === "tool_update") {
    appendLog(run, event.stream === "stderr" ? "stderr" : "stdout", event.output || "");
    return;
  }
  if (event.type === "tool_end") {
    appendLog(run, "tool", `${event.toolName || "tool"} ${event.success ? "completed" : "failed"} at ${timestamp}`);
    if (event.output) appendLog(run, "stdout", event.output);
    if (event.error) appendLog(run, "stderr", event.error);
    return;
  }
  if (event.type === "permission_request") {
    appendLog(run, "permission", `${event.tool || "tool"} requested permission: ${event.description || ""}`);
    return;
  }
  if (event.type === "agent_start") {
    appendLog(run, "sdk", `agent started: ${event.model || "default model"}`);
    return;
  }
  if (event.type === "agent_end") {
    appendLog(run, "sdk", `agent ended: ${event.reason || "completed"}`);
    return;
  }
  appendLog(run, "sdk", `${event.type || "event"} ${compactJson(event, 4000)}`);
}

function sdkTraceFromEvents(events, rawStdout = "", rawStderr = "") {
  const thoughts = [];
  const toolCalls = [];
  const toolResults = [];
  const messages = [];
  const orderedEvents = [];
  let currentAssistantText = "";

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const timestamp = sdkEventTimestamp(event);

    if (event.type === "plan_update") {
      orderedEvents.push({ ...event, timestamp });
      continue;
    }

    if (event.type === "message_update") {
      if (event.thought) {
        const thought = {
          thought: compactTraceText(event.thought, 18000),
          reflection: "",
          timestamp,
        };
        thoughts.push(thought);
        orderedEvents.push({ type: "thought", ...thought });
      }
      if (event.delta) currentAssistantText += event.delta;
      continue;
    }

    if (event.type === "message_end") {
      const content = compactTraceText(event.content || currentAssistantText, 24000);
      if (content) {
        const message = { role: "assistant", content, timestamp };
        messages.push(message);
        orderedEvents.push({ type: "assistant_event", ...message });
      }
      currentAssistantText = "";
      continue;
    }

    if (event.type === "tool_start") {
      const call = {
        id: String(event.toolId || ""),
        name: String(event.toolName || "tool"),
        args: event.args || {},
        timestamp,
      };
      toolCalls.push(call);
      orderedEvents.push({ type: "tool_call", call, timestamp });
      continue;
    }

    if (event.type === "tool_update" || event.type === "tool_end") {
      const content = compactTraceText(event.output || event.error || "", 24000);
      if (content) {
        const result = {
          id: String(event.toolId || ""),
          name: String(event.toolName || "tool"),
          content,
          timestamp,
        };
        toolResults.push(result);
        orderedEvents.push({ type: "tool_result", result, timestamp });
      }
      continue;
    }

    if (event.type === "permission_request") {
      orderedEvents.push({
        type: "permission_request",
        title: event.description || event.tool || "Permission requested",
        content: compactJson(event.context || {}, 6000),
        timestamp,
      });
      continue;
    }

    orderedEvents.push({
      type: String(event.type || "sdk_event"),
      title: String(event.reason || event.model || event.tool || ""),
      content: compactJson(event, 6000),
      timestamp,
    });
  }

  if (currentAssistantText.trim()) {
    const message = {
      role: "assistant",
      content: compactTraceText(currentAssistantText, 24000),
      timestamp: new Date().toISOString(),
    };
    messages.push(message);
    orderedEvents.push({ type: "assistant_event", ...message });
  }

  return {
    steps: [],
    thoughts,
    toolCalls,
    toolResults,
    messages,
    events: orderedEvents,
    raw: {
      stdout: compactTraceText(rawStdout),
      stderr: compactTraceText(rawStderr),
    },
  };
}

function sdkReplyFromEvents(events, rawStdout = "") {
  const lastMessageEnd = [...events].reverse().find((event) => event?.type === "message_end" && event.content);
  if (lastMessageEnd?.content) return String(lastMessageEnd.content).trim();
  const text = events
    .filter((event) => event?.type === "message_update" && event.delta)
    .map((event) => event.delta)
    .join("")
    .trim();
  return text || rawStdout.trim();
}

function chatStreamEventFromSdkEvent(event) {
  const timestamp = sdkEventTimestamp(event);

  if (event?.type === "plan_update") return { ...event, timestamp };

  if (event?.type === "message_update") {
    return {
      type: "message_delta",
      messageId: String(event.messageId || ""),
      delta: String(event.delta || ""),
      thought: String(event.thought || ""),
      timestamp,
    };
  }

  if (event?.type === "message_end") {
    return {
      type: "message_end",
      messageId: String(event.messageId || ""),
      content: compactTraceText(event.content || "", 24000),
      timestamp,
    };
  }

  if (event?.type === "tool_start") {
    return {
      type: "tool_start",
      tool: {
        id: String(event.toolId || ""),
        name: String(event.toolName || "tool"),
        args: event.args || {},
        timestamp,
      },
    };
  }

  if (event?.type === "tool_update") {
    return {
      type: "tool_update",
      toolId: String(event.toolId || ""),
      output: compactTraceText(event.output || "", 12000),
      stream: event.stream === "stderr" ? "stderr" : "stdout",
      timestamp,
    };
  }

  if (event?.type === "tool_end") {
    return {
      type: "tool_end",
      toolId: String(event.toolId || ""),
      toolName: String(event.toolName || "tool"),
      success: event.success !== false,
      output: compactTraceText(event.output || event.error || "", 12000),
      stream: event.error ? "stderr" : "stdout",
      timestamp,
    };
  }

  if (event?.type === "permission_request") {
    return {
      type: "permission_request",
      title: event.description || event.tool || "Permission requested",
      content: compactJson(event.context || {}, 6000),
      timestamp,
    };
  }

  if (event?.type === "error") {
    return {
      type: "error",
      error: event.message || event.error || "Agent stream failed",
      timestamp,
    };
  }

  return {
    type: "status",
    status: String(event?.status || event?.type || "sdk_event"),
    ...(event?.label ? { label: String(event.label) } : {}),
    timestamp,
  };
}

// A member that keeps producing events (tool calls, thinking, text) is
// working, however long it takes; only silence means trouble. The timeout is
// therefore an inactivity window that every event resets, under a hard
// ceiling so a runaway turn still ends.

async function collectSdkPrompt(sdk, prompt, timeoutMs, onEvent, signal, firstEventTimeoutMs = 45000) {
  const events = [];
  let rawStdout = "";
  let rawStderr = "";
  let timedOut = false;
  let stopped = false;
  let stalled = false;
  let gotFirstEvent = false;
  let timeout = null;
  let ceiling = null;
  let firstEventTimer = null;
  let abortHandler = null;
  const inactivityMs = Math.max(Number(timeoutMs) || 0, 60000);

  let rejectTimeout = () => {};
  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject;
    ceiling = setTimeout(() => {
      timedOut = true;
      reject(new Error(`chat stopped after ${Math.round(CHAT_TURN_CEILING_MS / 60000)} minutes, the longest a single turn may run`));
    }, CHAT_TURN_CEILING_MS);
  });
  const armInactivity = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      rejectTimeout(new Error(`no activity from Autohand Code for ${Math.round(inactivityMs / 60000)} minutes`));
    }, inactivityMs);
  };
  armInactivity();

  // First-event watchdog: a healthy turn emits agent/turn/message events within
  // a second or two. A long initial silence means the CLI exited (e.g. it
  // rejected a stale/server-invalid auth token with a JSON-RPC error the SDK
  // can't match to our request and so never surfaces) or never reached the
  // provider. Fail fast with an actionable message instead of stalling for the
  // full turn timeout.
  const firstEventPromise = firstEventTimeoutMs
    ? new Promise((_, reject) => {
        firstEventTimer = setTimeout(() => {
          if (gotFirstEvent) return;
          stalled = true;
          reject(
            new AutohandStallError(
              "The Autohand CLI did not respond. It may have exited or needs sign-in — run `autohand login` in your terminal, then retry."
            )
          );
        }, firstEventTimeoutMs);
      })
    : null;

  const abortPromise = signal
    ? new Promise((_, reject) => {
        abortHandler = () => {
          stopped = true;
          reject(new Error(stopMessage(signal)));
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      })
    : null;

  const collectPromise = (async () => {
    for await (const event of sdk.streamPrompt({ message: prompt })) {
      if (!gotFirstEvent) {
        gotFirstEvent = true;
        if (firstEventTimer) clearTimeout(firstEventTimer);
      }
      if (signal?.aborted) {
        stopped = true;
        throw new Error(stopMessage(signal));
      }
      events.push(event);
      armInactivity();
      if (event?.type === "message_update" && event.delta) rawStdout += event.delta;
      if (event?.type === "message_end" && event.content && !rawStdout.includes(event.content)) {
        rawStdout += event.content;
      }
      if (event?.type === "tool_update") {
        if (event.stream === "stderr") rawStderr += event.output || "";
        else rawStdout += event.output || "";
      }
      onEvent?.(event);
    }
    return { events, rawStdout, rawStderr, timedOut };
  })();

  try {
    const racers = [collectPromise, timeoutPromise];
    if (firstEventPromise) racers.push(firstEventPromise);
    if (abortPromise) racers.push(abortPromise);
    return await Promise.race(racers);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (ceiling) clearTimeout(ceiling);
    if (firstEventTimer) clearTimeout(firstEventTimer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    if (timedOut || stopped || stalled || signal?.aborted) {
      await sdk.interrupt?.().catch(() => {});
    }
  }
}

async function startSdkRun(run, payload, { workspace, prompt, agentRuntime }) {
  let AutohandSDK;
  try {
    ({ AutohandSDK } = await loadAgentSdk());
  } catch (error) {
    throw new SdkBridgeStartupError(`SDK unavailable: ${error.message}`, error);
  }
  if (!AutohandSDK) {
    throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
  }

  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const context = sdkRuntimeContext(payload, workspace, profile, agentRuntime);
  const sdk = new AutohandSDK(context.options);
  run.sdk = sdk;
  run.transport = "sdk";
  run.command = context.command;
  appendLog(run, "system", `started SDK transport ${run.command}`);

  try {
    await sdk.start();
  } catch (error) {
    run.sdk = null;
    await sdk.close?.().catch(() => {});
    throw new SdkBridgeStartupError(`SDK startup failed: ${error.message}`, error);
  }

  void (async () => {
    try {
      const output = await collectSdkPrompt(sdk, prompt, 300000, (event) => appendSdkEventLog(run, event), run.abortController.signal);
      if (run.status !== "stopped") {
        run.trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
        const reply = sdkReplyFromEvents(output.events, output.rawStdout);
        const failure = replyFailure(output.events, reply);
        if (failure) throw new Error(failure.message);
        if (!await finishRunChannelActions(run, payload, reply, run.trace)) return;
        run.exitCode = 0;
        run.status = "completed";
        run.finishedAt = new Date().toISOString();
        emitRunFinished(run);
        appendLog(run, "system", "SDK run completed");
        recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: run.status, trace: run.trace, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt, runId: run.id }));
      }
    } catch (error) {
      if (run.status !== "stopped") {
        run.exitCode = 1;
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        emitRunFinished(run);
        appendLog(run, "stderr", error.message || String(error));
        recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: run.status, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt, runId: run.id }));
      }
    } finally {
      await sdk.close?.().catch((error) => appendLog(run, "system", `SDK close failed: ${error.message}`));
      run.sdk = null;
    }
  })();
}

function startCliRun(run, args, workspace, agentRuntime, payload) {
  run.transport = "cli";
  const child = spawn(resolveAutohandBinary() || "autohand", args, {
    cwd: workspace,
    env: {
      ...process.env,
      ...agentRuntimeEnvVars(agentRuntime),
      FORCE_COLOR: "0",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  run.process = child;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  appendLog(run, "system", `started ${run.command}`);

  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; appendLog(run, "stdout", chunk); });
  child.stderr.on("data", (chunk) => { stderr += chunk; appendLog(run, "stderr", chunk); });
  child.on("error", (error) => {
    if (run.status === "stopped") return;
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    emitRunFinished(run);
    appendLog(run, "system", error.message);
  });
  child.on("close", async (code) => {
    run.exitCode = code;
    if (run.status === "stopped") {
      appendLog(run, "system", `stopped with code ${code}`);
      recordUsageTelemetry("usage.recorded", usageMetadata({ payload: { agentId: run.agentId }, agentRuntime, transport: "cli", status: run.status, command: run.command, startedAt: run.startedAt, completedAt: new Date().toISOString(), runId: run.id }));
      return;
    }
    // A spawn error also emits close. Keep its failure, and never process
    // model actions from a failed process.
    if (run.finishedEventAt) return;
    try {
      run.trace = await buildChatTrace({ agentHome: agentRuntime.agentHome, startedAt: Date.parse(run.startedAt), stdout, stderr, prompt: String(payload.prompt || ""), command: run.command, exitCode: code });
      if (code === 0 && !await finishRunChannelActions(run, payload, formatChatReply(stdout, stderr, String(payload.prompt || "")), run.trace)) return;
      if (run.status === "stopped") return;
      run.status = code === 0 ? "completed" : "failed";
    } catch (error) {
      if (run.status === "stopped") return;
      run.status = "failed";
      run.exitCode = 1;
      appendLog(run, "stderr", error.message || String(error));
    }
    run.finishedAt = new Date().toISOString();
    emitRunFinished(run);
    appendLog(run, "system", `exited with code ${code}`);
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload: { agentId: run.agentId }, agentRuntime, transport: "cli", status: run.status, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt, runId: run.id }));
  });
}

async function finishRunChannelActions(run, payload, reply, trace) {
  if (run.status === "stopped" || run.abortController?.signal.aborted) return false;
  const finished = await agentChannelActions.finish(payload._channelActionContext, { reply, trace }, run.abortController?.signal);
  const result = withTeamReceipts(finished, team.takeReceipts(payload._computerUseWorkId || run.id));
  if (run.status === "stopped" || run.abortController?.signal.aborted) return false;
  run.reply = result.reply;
  run.channelActions = result.channelActions || [];
  for (const receipt of run.channelActions) appendLog(run, "squad", receipt.message);
  return true;
}

async function chatOnceWithSdk(payload, { workspace, prompt, agentRuntime, timeoutMs, startedAt }) {
  let AutohandSDK;
  try {
    ({ AutohandSDK } = await loadAgentSdk());
  } catch (error) {
    throw new SdkBridgeStartupError(`SDK unavailable: ${error.message}`, error);
  }
  if (!AutohandSDK) {
    throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
  }

  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const context = sdkRuntimeContext(payload, workspace, profile, agentRuntime);
  let started = false;
  let eventCount = 0;
  let lease = null;
  let healthy = false;

  try {
    lease = await acquireSdkLease(payload, workspace, context);
    const sdk = lease.sdk;
    started = true;
    const output = await collectSdkPrompt(sdk, prompt, timeoutMs, () => {
      eventCount += 1;
    });
    healthy = true;
    const reply = sdkReplyFromEvents(output.events, output.rawStdout);
    // The SDK reports provider and session failures as events, not as thrown
    // errors, so a failed turn ends cleanly with nothing in it. Without this
    // the empty reply became "Autohand returned no chat text." and a safety
    // block, an oversized payload and a stalled stream were indistinguishable
    // (ADR-0061).
    const failure = replyFailure(output.events, reply);
    const trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
    const completedAt = Date.now();
    trace.command = context.command;
    trace.exitCode = 0;
    trace.transport = "sdk";
    trace.startedAt = new Date(startedAt).toISOString();
    trace.completedAt = new Date(completedAt).toISOString();
    trace.durationMs = completedAt - startedAt;
    if (failure) throw new ChatRuntimeError(failure.message, { reply: "", trace, workspace, transport: "sdk" });
    const result = {
      reply: reply || "Autohand returned no chat text.",
      trace,
      workspace,
      command: context.command,
      transport: "sdk",
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      durationMs: trace.durationMs,
      configPath: agentRuntime.configPath,
      displayConfigPath: agentRuntime.displayConfigPath,
      agentHome: agentRuntime.agentHome,
      effectiveModel: agentRuntime.effectiveModel,
      skillInstall: agentRuntime.skillInstall,
      profileDocs: agentRuntime.profileDocs,
      brainCard: agentRuntime.brainCard,
      channel: channelContextFromPayload(payload),
      contextLayers: chatContextLayers(payload, agentRuntime, trace),
    };
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: "completed", trace, command: context.command }));
    return result;
  } catch (error) {
    if (error instanceof AutohandStallError) {
      throw decorateStallError(error, agentRuntime);
    }
    if (!started || eventCount === 0) {
      throw new SdkBridgeStartupError(`SDK prompt failed before producing events: ${error.message}`, error);
    }
    throw error;
  } finally {
    await lease?.release(healthy && !agentRuntime.computerUse);
  }
}

// Acquire a warm session for this member; the launch options (config, flags,
// profile, model) are part of the key, so a changed profile starts fresh.
async function acquireSdkLease(payload, workspace, context) {
  const pool = await sdkSessionPool();
  const agentId = sanitizeAgentId(payload.agent?.id || payload.agentId || "member");
  return pool.acquire({ agentId, workspace, options: context.options, command: context.command });
}

// A stall means the CLI produced no event at all. Attach what it wrote to its
// own error log so the user sees the cause instead of a generic timeout.
function decorateStallError(error, agentRuntime) {
  try {
    const errorLog = join(agentRuntime.agentHome, "error.log");
    if (existsSync(errorLog)) {
      const tail = readFileSync(errorLog, "utf8").trim().split(/\r?\n/).slice(-6).join("\n").slice(-900);
      if (tail) {
        error.details = { ...(error.details || {}), cliErrorLog: tail };
        error.message = `${error.message} Last CLI error: ${tail.split("\n").at(-1).slice(0, 240)}`;
      }
    }
  } catch {
    // Diagnostics are optional.
  }
  return error;
}

async function streamChatWithSdk(payload, { workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal }) {
  stream.send("sdk", {
    type: "status",
    status: "sdk_prepare",
    label: "Preparing SDK transport...",
    timestamp: new Date().toISOString(),
  });

  let AutohandSDK;
  try {
    ({ AutohandSDK } = await loadAgentSdk());
  } catch (error) {
    throw new SdkBridgeStartupError(`SDK unavailable: ${error.message}`, error);
  }
  if (!AutohandSDK) {
    throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
  }

  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const context = sdkRuntimeContext(payload, workspace, profile, agentRuntime);
  let started = false;
  let eventCount = 0;
  let lease = null;
  let healthy = false;

  try {
    stream.send("sdk", {
      type: "status",
      status: "sdk_start",
      label: "Starting the local agent bridge...",
      timestamp: new Date().toISOString(),
    });
    lease = await acquireSdkLease(payload, workspace, context);
    const sdk = lease.sdk;
    started = true;
    stream.send("sdk", {
      type: "status",
      status: "prompt_start",
      label: lease.created ? "Sending the request to the model..." : "Reusing the warm session; sending the request...",
      timestamp: new Date().toISOString(),
    });
    const output = await collectSdkPrompt(sdk, prompt, timeoutMs, (event) => {
      eventCount += 1;
      stream.send("sdk", chatStreamEventFromSdkEvent(event));
    }, signal);
    healthy = true;
    const reply = sdkReplyFromEvents(output.events, output.rawStdout);
    // The SDK reports provider and session failures as events, not as thrown
    // errors, so a failed turn ends cleanly with nothing in it. Without this
    // the empty reply became "Autohand returned no chat text." and a safety
    // block, an oversized payload and a stalled stream were indistinguishable
    // (ADR-0061).
    const failure = replyFailure(output.events, reply);
    const trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
    const completedAt = Date.now();
    trace.command = context.command;
    trace.exitCode = 0;
    trace.transport = "sdk";
    trace.startedAt = new Date(startedAt).toISOString();
    trace.completedAt = new Date(completedAt).toISOString();
    trace.durationMs = completedAt - startedAt;
    if (failure) throw new ChatRuntimeError(failure.message, { reply: "", trace, workspace, transport: "sdk" });
    const result = {
      reply: reply || "Autohand returned no chat text.",
      trace,
      workspace,
      command: context.command,
      transport: "sdk",
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      durationMs: trace.durationMs,
      configPath: agentRuntime.configPath,
      displayConfigPath: agentRuntime.displayConfigPath,
      agentHome: agentRuntime.agentHome,
      effectiveModel: agentRuntime.effectiveModel,
      skillInstall: agentRuntime.skillInstall,
      profileDocs: agentRuntime.profileDocs,
      brainCard: agentRuntime.brainCard,
      channel: channelContextFromPayload(payload),
      contextLayers: chatContextLayers(payload, agentRuntime, trace),
    };
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: "completed", trace, command: context.command }));
    stream.send("done", result);
    return result;
  } catch (error) {
    // A person pressing Stop is not a sick session. Discarding it here cost a
    // full cold start on the next message (ADR-0030).
    if (isAbortError(error) || signal?.aborted) healthy = started;
    if (error instanceof AutohandStallError) {
      throw decorateStallError(error, agentRuntime);
    }
    if (!started || eventCount === 0) {
      stream.send("sdk", {
        type: "status",
        status: "sdk_startup_failed",
        label: `SDK bridge did not produce events (${String(error?.message || error || "no reason given").replace(/\s+/g, " ").slice(0, 200)}); trying CLI transport...`,
        timestamp: new Date().toISOString(),
      });
      throw new SdkBridgeStartupError(`SDK prompt failed before producing events: ${error.message}`, error);
    }
    throw error;
  } finally {
    await lease?.release(healthy && !agentRuntime.computerUse);
  }
}

/** A cancelled request, however the runtime chose to spell it. */
function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR" || /\baborted\b/i.test(String(error?.message || ""));
}

// ---------------------------------------------------------------------------
// External harness execution (Codex, Claude Code). The Autohand path above is
// unchanged; these functions reuse the same event, trace, and reply helpers so
// the UI renders every harness identically.
// ---------------------------------------------------------------------------

async function prepareExternalHarness(payload, { mode = "prompt" } = {}) {
  const workspace = await cleanWorkspace(payload.workspace);
  const prompt = String(payload.prompt || "").trim();
  let profile = String(payload.profile || "").trim().slice(0, 12000);
  const agentRuntime = await ensureAgentRuntime(payload, workspace);
  const assignment = harnessAssignmentFromAgent(agentRuntime.agent);
  const adapter = getAdapter(assignment);
  // Stable instructions and the turn's own context are kept apart so Codex,
  // which has no system prompt, can be sent the context on every turn and
  // the instructions only when they change (ADR-0134).
  const stableProfile = [runtimeProfilePrompt(profile, agentRuntime), computerUseInstructions(agentRuntime), connectorInstructions(agentRuntime.connectorServers), vaultInstructions(agentRuntime)].filter(Boolean).join("\n\n");
  const turnContext = [teamInstructionsFor(agentRuntime), recallInstructions(payload), workPlanInstructions(payload), memberShapingInstructions(payload)].filter(Boolean).join("\n\n");
  profile = [stableProfile, turnContext].filter(Boolean).join("\n\n");
  const readiness = await assertHarnessReady(assignment, { context: harnessContextFor(assignment.id) });
  const permissions = normalizeAgentPermissions(agentRuntime.agent);
  const addDirs = [];
  if (agentRuntime.profileDocs?.path) addDirs.push(agentRuntime.profileDocs.path);
  if (canvasDirFor(payload)) addDirs.push(canvasDirFor(payload));
  for (const project of normalizeAgentProjects(agentRuntime.agent)) {
    if (project.path !== workspace) addDirs.push(project.path);
  }
  // The engine's own folders (Claude Code's plans dir) are always reachable (ADR-0116).
  for (const dir of typeof adapter.engineDirs === "function" ? adapter.engineDirs() : []) {
    if (dir && dir !== workspace && !addDirs.includes(dir)) addDirs.push(dir);
  }
  const model = String(payload.model || assignment.model || "").trim();
  // Access and reasoning effort (ADR-0114): the turn's explicit choice, else
  // the member's engine settings, else nothing (the adapter derives access).
  const access = normalizeAccess(payload.access || assignment.access);
  const effort = normalizeEffort(payload.effort || assignment.effort);
  // A one-off bridge turn (an automation draft, ADR-0125) neither resumes nor
  // replaces the member's saved session, so its conversation is untouched.
  const ephemeral = payload.ephemeralSession === true;
  const resumeId = payload.resumeSession === false || ephemeral ? "" : await readResumeId(agentRuntime.agentHome, adapter.id, workspace);
  // Squad-managed MCP servers (Computer Use, the vault) reach Claude through
  // one --mcp-config file and Codex through -c overrides, adapted per harness.
  const managedServers = [agentRuntime.computerUse?.mcpServer, agentRuntime.vault?.mcpServer, agentRuntime.team?.mcpServer].filter(Boolean);
  let managedConfigPath = "";
  if (managedServers.length && adapter.id === "claude") {
    const owner = agentRuntime.computerUse || agentRuntime.vault || agentRuntime.team;
    const directory = join(agentRuntime.agentHome, agentRuntime.computerUse ? "computer-use-configs" : agentRuntime.vault ? "vault-configs" : "team-configs");
    managedConfigPath = join(directory, agentRuntime.computerUse ? `${owner.id}.claude.json` : "member.claude.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeSecretFile(managedConfigPath, JSON.stringify({ mcpServers: Object.fromEntries(managedServers.map((server) => [server.name, { command: server.command, args: server.args, env: server.env }])) }));
    owner.externalConfigPath = managedConfigPath;
  }
  // Connectors for Claude travel in a private --mcp-config file rewritten
  // every turn; Codex takes them as -c overrides (ADR-0107).
  const connectorSpecs = Array.isArray(agentRuntime.connectorServers) ? agentRuntime.connectorServers : [];
  let connectorConfigPath = "";
  if (connectorSpecs.length && adapter.id === "claude") {
    const directory = join(agentRuntime.agentHome, "connector-configs");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    connectorConfigPath = join(directory, "claude.json");
    await writeSecretFile(connectorConfigPath, JSON.stringify(claudeMcpConfig(connectorSpecs)));
  }
  const codexInstructions = adapter.id === "codex" ? await codexInstructionsState(agentRuntime.agentHome, workspace, stableProfile) : null;
  const build = (resume) => {
    const built = adapter.buildArgs({
      prompt: mode === "auto" ? `${prompt}\n\nWork autonomously until the task is complete, then summarise what changed.` : prompt,
      workspace,
      model,
      permissions,
      policy: payload.policy || "",
      access,
      effort,
      efforts: Array.isArray(readiness.efforts) ? readiness.efforts : [],
      ...(codexInstructions ? { appendSystemPrompt: stableProfile, turnContext, resendInstructions: codexInstructions.changed } : { appendSystemPrompt: profile }),
      addDirs,
      resumeId: resume,
      launchArgs: Array.isArray(readiness.launchArgs) ? readiness.launchArgs : [],
      mcpServers: [...managedServers, ...autohandServersFor(connectorSpecs)],
    });
    if (managedServers.length && adapter.id === "claude") {
      built.args.push("--mcp-config", managedConfigPath);
      built.displayArgs.push("--mcp-config", "<squad-managed-mcp-config>");
    } else if (managedServers.length && adapter.id === "codex") {
      for (const server of managedServers) {
        const prefix = `mcp_servers.${server.name}`;
        const values = [`${prefix}.command=${JSON.stringify(server.command)}`, `${prefix}.args=${JSON.stringify(server.args)}`, `${prefix}.env={${Object.entries(server.env).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(",")}}`];
        // A teammate's reply can take most of a minute; Codex's default tool timeout is 60 s.
        if (server.name === TEAM_MCP_SERVER_NAME) values.push(`${prefix}.tool_timeout_sec=120`);
        for (const value of values) built.args.unshift("-c", value);
      }
      built.displayArgs.unshift("-c", "<squad-managed-mcp-config>");
    }
    if (connectorConfigPath && adapter.id === "claude") {
      built.args.push("--mcp-config", connectorConfigPath);
      built.displayArgs.push("--mcp-config", "<squad-connectors-config>");
    } else if (connectorSpecs.length && adapter.id === "codex") {
      const overrides = codexConfigArgs(connectorSpecs);
      for (let index = overrides.length - 2; index >= 0; index -= 2) built.args.unshift(overrides[index], overrides[index + 1]);
      built.displayArgs.unshift("-c", "<squad-connectors-config>");
    }
    return built;
  };
  return {
    assignment,
    adapter,
    readiness,
    workspace,
    prompt,
    profile,
    agentRuntime,
    permissions,
    model,
    access,
    effort,
    resumeId,
    ephemeral,
    build,
    executable: readiness.executablePath,
    envVars: {
      AUTOHAND_SQUAD_MEMBER: agentRuntime.agentId,
      AUTOHAND_SQUAD_HARNESS: adapter.id,
      AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: "",
    },
  };
}

// What Codex was last told, per member and folder: a digest of the stable
// instructions. A resumed thread is sent them again only when the digest
// changed (ADR-0134). Written before the turn, so a failed turn may skip one
// resend; the next change sends them again.
async function codexInstructionsState(agentHome, workspace, stableProfile) {
  const file = join(agentHome, "codex-instructions.json");
  const digest = createHash("sha256").update(stableProfile).digest("hex").slice(0, 32);
  const saved = await readPersistentJson(file, {}).catch(() => ({}));
  const key = createHash("sha256").update(String(workspace || "")).digest("hex").slice(0, 16);
  const changed = saved?.[key] !== digest;
  if (changed) await writePersistentJson(file, { ...(saved && typeof saved === "object" ? saved : {}), [key]: digest }).catch(() => {});
  return { changed };
}

function externalCommandLabel(adapter, displayArgs) {
  return `${adapter.executableName} ${displayArgs.map(shellQuote).join(" ")}`;
}

async function executeExternalHarness(prepared, { timeoutMs, inactivityMs = 0, signal, onEvent }) {
  const { adapter, executable, workspace, envVars, agentRuntime } = prepared;
  const note = (label) => {
    try { onEvent({ type: "status", status: "harness_cold_start", label, timestamp: new Date().toISOString() }); } catch {}
  };
  // ACP agents (ADR-0122) speak JSON-RPC over stdio and bring their own
  // runner; the turn travels in `attempt.turn`. Everything after is shared.
  const runOnce = (attempt) => (adapter.transport === "acp"
    ? adapter.run({ adapter, executable, args: attempt.args, cwd: workspace, env: envVars, turn: attempt.turn, timeoutMs, inactivityMs, signal, onEvent, terminate: terminateChildProcess, clientVersion: packageMetadata.version })
    : runExternalHarness({ adapter, executable, args: attempt.args, cwd: workspace, env: envVars, timeoutMs, inactivityMs, signal, onEvent, terminate: terminateChildProcess,
      harnessVersion: prepared.readiness.version, models: prepared.readiness.models || [],
      modelRecoveryPath: prepared.ephemeral ? '' : join(agentRuntime.agentHome, 'claude-model-routing.json'),
      modelAccountKey: `${prepared.readiness.account?.method || ''}:${prepared.readiness.account?.label || ''}`,
    }));
  // What a start failure looked like, in words (ADR-0123): the engine's own
  // disk and the workspace's are measured once per turn, only when needed.
  const classify = (output) => classifyColdStart({
    adapterLabel: adapter.label,
    output,
    durationMs: output.durationMs,
    executable: redactHome(executable),
    freeBytes: {
      home: freeDiskBytes(engineHome(adapter.id, { homeDir, agentHome: agentRuntime.agentHome })),
      workspace: freeDiskBytes(workspace),
    },
  });
  let attempt = prepared.build(prepared.resumeId);
  let output = await runOnce(attempt);
  let cold = output.error ? classify(output) : null;
  // A transient start failure (disk, runtime) gets one quiet retry with the
  // same session: the conversation was never the problem.
  if (cold?.transient && !signal?.aborted) {
    note(`${cold.detail}; retrying once in ${formatDuration(COLD_START_RETRY_DELAY_MS)}.`);
    logEvent(SEVERITY.WARN, `${adapter.label} cold start: ${cold.detail}; retrying once`, { "event.name": "harness.cold_start", "autohand.harness": adapter.id, "autohand.member.id": agentRuntime.agentId, "autohand.cold_start.kind": cold.kind });
    await new Promise((resolve) => setTimeout(resolve, COLD_START_RETRY_DELAY_MS));
    output = await runOnce(attempt);
    cold = output.error ? classify(output) : null;
    if (!output.error) note(`${adapter.label} started on the second attempt.`);
  }
  if (cold) {
    note(cold.detail);
    logEvent(SEVERITY.ERROR, `${adapter.label} cold start: ${cold.detail}`, { "event.name": "harness.cold_start", "autohand.harness": adapter.id, "autohand.member.id": agentRuntime.agentId, "autohand.cold_start.kind": cold.kind });
    output = { ...output, error: cold.reason, coldStart: cold };
  } else if (output.error && prepared.resumeId && !output.stopped && !output.timedOut && looksLikeStaleSession(output)) {
    // A stale resume id (deleted session, new vendor version) must not strand
    // the member: retry once with a fresh session, then persist the new id.
    // Only when the engine said the session is the problem; a start failure
    // used to land here and wiped the member's conversation (ADR-0123).
    note(`${adapter.label} could not resume the saved session; starting a fresh one.`);
    await writeResumeId(agentRuntime.agentHome, adapter.id, workspace, "");
    attempt = prepared.build("");
    output = await runOnce(attempt);
  }
  if (output.resumeId && !output.stopped && !prepared.ephemeral) {
    await writeResumeId(agentRuntime.agentHome, adapter.id, workspace, output.resumeId).catch(() => {});
  }
  return { ...output, command: externalCommandLabel(adapter, attempt.displayArgs) };
}

function externalHarnessResult(prepared, output, { startedAt, payload }) {
  const { adapter, workspace, agentRuntime } = prepared;
  const reply = sdkReplyFromEvents(output.events, "");
  const trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
  const completedAt = Date.now();
  const usageEvent = [...output.events].reverse().find((event) => event.type === "usage");
  if (usageEvent?.usage) trace.usage = usageEvent.usage;
  trace.command = output.command;
  trace.exitCode = output.exitCode;
  trace.transport = adapter.id;
  trace.runtimeTransport = output.sdkTransport || 'cli';
  trace.harness = adapter.id;
  trace.sessionId = output.resumeId || "";
  trace.startedAt = new Date(startedAt).toISOString();
  trace.completedAt = new Date(completedAt).toISOString();
  trace.durationMs = completedAt - startedAt;
  return {
    reply: reply || `${adapter.label} returned no chat text.`,
    trace,
    workspace,
    command: output.command,
    transport: adapter.id,
    harness: adapter.id,
    harnessVersion: prepared.readiness.version || "",
    sessionId: output.resumeId || "",
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    durationMs: trace.durationMs,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    effectiveModel: { provider: adapter.vendor.toLowerCase(), model: output.effectiveModel || [...output.events].reverse().find(event => event.type === 'agent_start' && event.model)?.model || prepared.model || '' },
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    channel: channelContextFromPayload(payload),
    contextLayers: chatContextLayers(payload, agentRuntime, trace),
  };
}

async function chatOnceWithExternalHarness(payload) {
  const prepared = await prepareExternalHarness(payload);
  if (!prepared.prompt) throw new Error("prompt is required");
  const channelContext = channelContextFromPayload(payload);
  if (channelContext) {
    await recordChannelDispatch(channelContext, { prompt: prepared.prompt, agentId: payload.agentId || prepared.agentRuntime.agentId });
  }
  const requestedTimeout = Number(payload.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 15000), 600000) : 300000;
  const startedAt = Date.now();
  const output = await executeExternalHarness(prepared, { timeoutMs: CHAT_TURN_CEILING_MS, inactivityMs: timeoutMs, onEvent: () => {} });
  const result = externalHarnessResult(prepared, output, { startedAt, payload });
  const status = output.error ? "failed" : "completed";
  recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime: { ...prepared.agentRuntime, effectiveModel: result.effectiveModel }, transport: prepared.adapter.id, status, trace: result.trace, command: output.command }));
  if (output.error) throw new ChatRuntimeError(output.error, result);
  return result;
}

async function streamChatWithExternalHarness(payload, { stream, signal, startedAt }) {
  const prepared = await prepareExternalHarness(payload);
  await memberAvailability.assertCanWork(payload);
  if (!prepared.prompt) throw new Error("prompt is required");
  if (signal?.aborted) throw new Error(stopMessage(signal));
  const channelContext = channelContextFromPayload(payload);
  if (channelContext) {
    await recordChannelDispatch(channelContext, { prompt: prepared.prompt, agentId: payload.agentId || prepared.agentRuntime.agentId });
  }
  const requestedTimeout = Number(payload.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 15000), 600000) : 300000;
  stream.send("start", {
    startedAt: new Date(startedAt).toISOString(),
    workspace: prepared.workspace,
    effectiveModel: { provider: prepared.adapter.vendor.toLowerCase(), model: prepared.model },
    harness: prepared.adapter.id,
    harnessVersion: prepared.readiness.version || "",
    channel: channelContext,
  });
  stream.send("sdk", {
    type: "status",
    status: "harness_start",
    label: `Starting ${prepared.adapter.label}${prepared.resumeId ? " (resuming session)" : ""}...`,
    timestamp: new Date().toISOString(),
  });
  const output = await executeExternalHarness(prepared, {
    timeoutMs: CHAT_TURN_CEILING_MS,
    inactivityMs: timeoutMs,
    signal,
    onEvent: (event) => stream.send("sdk", chatStreamEventFromSdkEvent(event)),
  });
  const result = externalHarnessResult(prepared, output, { startedAt, payload });
  const status = output.error ? "failed" : "completed";
  recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime: { ...prepared.agentRuntime, effectiveModel: result.effectiveModel }, transport: prepared.adapter.id, status, trace: result.trace, command: output.command }));
  if (output.error) throw new ChatRuntimeError(output.error, result);
  stream.send("done", result);
  return result;
}

async function startExternalHarnessRun(payload) {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  const id = payload._computerUseWorkId || randomUUID();
  payload = { ...payload, _computerUseWorkId: id };
  const mode = payload.mode || "prompt";
  if (mode === "permissions") {
    throw new Error("Permission inspection is only available for Autohand members.");
  }
  const prepared = await prepareExternalHarness(payload, { mode });
  await memberAvailability.assertCanWork(payload);
  if (!prepared.prompt) throw new Error("prompt is required");
  const { adapter, workspace, agentRuntime } = prepared;
  const contextPack = generateContextPack(mode, payload, agentRuntime, workspace);
  const layerPayload = contextPack
    ? { ...payload, contextPack: { id: contextPack.id, taskId: contextPack.taskId, summary: contextPack.summary } }
    : payload;
  const channelContext = channelContextFromPayload(payload);
  const initialArgs = prepared.build(prepared.resumeId);
  const run = {
    id,
    agentId: payload.agentId || agentRuntime.agentId,
    title: payload.title || prepared.prompt,
    mode,
    channel: channelContext,
    recipeId: typeof payload.recipeId === "string" && payload.recipeId ? payload.recipeId : null,
    canvasId: typeof payload.canvasId === "string" && payload.canvasId ? payload.canvasId : null,
    workspace,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    effectiveModel: { provider: adapter.vendor.toLowerCase(), model: prepared.model },
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    transport: adapter.id,
    computerUse: agentRuntime.computerUse ? { sessionId: agentRuntime.computerUse.id, runId: id, files: [] } : null,
    harness: adapter.id,
    harnessVersion: prepared.readiness.version || "",
    command: externalCommandLabel(adapter, initialArgs.displayArgs),
    logPath: join(runLogsDir, `${id}.otlp.jsonl`),
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    contextPack,
    contextLayers: assembleContextLayers(mode, layerPayload, agentRuntime),
    logs: [],
    abortController: new AbortController(),
  };
  runs.set(id, run);
  appendLog(run, "system", `started ${adapter.label} ${prepared.readiness.version || ""} transport ${run.command}`.replace("  ", " "));
  if (channelContext) {
    appendLog(run, "channel", `Channel dispatch ${channelContext.channelName || channelContext.channelId}${channelContext.threadId ? ` thread ${channelContext.threadId}` : ""}.`);
    await recordChannelDispatch(channelContext, { prompt: prepared.prompt, agentId: run.agentId });
  }
  const maxRuntimeMs = mode === "auto" ? Math.min(Math.max(Number(payload.maxRuntime || 120), 1), 240) * 60_000 : 600000;
  void (async () => {
    try {
      const output = await executeExternalHarness(prepared, {
        timeoutMs: maxRuntimeMs,
        signal: run.abortController.signal,
        onEvent: (event) => appendSdkEventLog(run, event),
      });
      run.command = output.command;
      if (output.effectiveModel) run.effectiveModel = { provider: adapter.vendor.toLowerCase(), model: output.effectiveModel };
      if (run.status !== "stopped") {
        run.trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
        run.trace.harness = adapter.id;
        run.trace.sessionId = output.resumeId || "";
        if (!output.error && !await finishRunChannelActions(run, payload, sdkReplyFromEvents(output.events, ""), run.trace)) return;
        run.exitCode = output.exitCode;
        run.status = output.error ? "failed" : "completed";
        run.finishedAt = new Date().toISOString();
        emitRunFinished(run);
        if (output.error) appendLog(run, "stderr", output.error);
        appendLog(run, "system", `${adapter.label} run ${run.status}`);
        recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime: { ...agentRuntime, effectiveModel: run.effectiveModel }, transport: adapter.id, status: run.status, trace: run.trace, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt }));
      }
    } catch (error) {
      if (run.status !== "stopped") {
        run.exitCode = 1;
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        emitRunFinished(run);
        appendLog(run, "stderr", error.message || String(error));
      }
    } finally {
      run.abortController = null;
    }
  })();
  return runSummary(run);
}

async function startRun(payload) {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  const id = randomUUID();
  payload = { ...await withSavedMember(payload), _computerUseWorkId: id };
  payload._channelActionContext = await agentChannelActions.begin({ ...payload, requestId: payload.requestId || `run-${id}` });
  try { return await startRunInner(payload); }
  catch (error) { await Promise.allSettled([finishComputerWork(id), finishVaultWork(id), finishTeamWork(id)]); throw error; }
}

async function startRunInner(payload) {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  const memberId = String(payload.agentId || payload.agent?.id || "");
  projectObserver.deferMember(memberId, "An assigned run takes priority.");
  observerRunStarts.set(memberId, (observerRunStarts.get(memberId) || 0) + 1);
  try { return await startPreparedRun(payload); }
  finally { const remaining = observerRunStarts.get(memberId) - 1; if (remaining > 0) observerRunStarts.set(memberId, remaining); else observerRunStarts.delete(memberId); }
}

async function startPreparedRun(payload) {
  const id = payload._computerUseWorkId;
  await memberAvailability.assertCanWork(payload);
  if (isExternalHarness(harnessAssignmentFromAgent(payload.agent))) {
    return startExternalHarnessRun(payload);
  }
  const { args, displayArgs, workspace, prompt, mode, agentRuntime } = await autohandArgs(payload);
  await memberAvailability.assertCanWork(payload);
  if (!prompt && mode !== "permissions") {
    throw new Error("prompt is required");
  }
  assertAutohandAuth(agentRuntime);

  // Goal 08: generate the context pack before the run starts and reference it
  // from the launch payload so the taskContextPack layer cites the same pack.
  const contextPack = mode === "permissions"
    ? (payload?.contextPack && typeof payload.contextPack === "object" ? payload.contextPack : null)
    : generateContextPack(mode, payload, agentRuntime, workspace);
  const layerPayload = contextPack
    ? { ...payload, contextPack: { id: contextPack.id, taskId: contextPack.taskId, summary: contextPack.summary } }
    : payload;

  const channelContext = channelContextFromPayload(payload);
  const run = {
    id,
    agentId: payload.agentId || agentRuntime.agentId,
    title: payload.title || prompt || "Autohand permissions",
    mode,
    // Squad channels: tag the run with its channel/thread so queue and run
    // telemetry can group channel dispatches after reloads.
    channel: channelContext,
    // Goal 09: tag the run with the recipe it launched from so the evidence
    // timeline and done-criteria checks can reference the recipe by id.
    recipeId: typeof payload.recipeId === "string" && payload.recipeId ? payload.recipeId : null,
    canvasId: typeof payload.canvasId === "string" && payload.canvasId ? payload.canvasId : null,
    workspace,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    effectiveModel: agentRuntime.effectiveModel,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    transport: "cli",
    computerUse: agentRuntime.computerUse ? { sessionId: agentRuntime.computerUse.id, runId: id, files: [] } : null,
    command: `autohand ${displayArgs.map(shellQuote).join(" ")}`,
    logPath: join(runLogsDir, `${id}.otlp.jsonl`),
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    contextPack,
    contextLayers: assembleContextLayers(mode, layerPayload, agentRuntime),
    logs: [],
    abortController: new AbortController(),
  };
  runs.set(id, run);

  // Goal 08: name the context pack in the launch transcript so the run timeline
  // records exactly which pack the agent started from.
  if (contextPack) {
    const c = contextPack.counts || {};
    appendLog(
      run,
      "context-pack",
      `Context pack ${contextPack.id} generated for ${contextPack.included?.repoSummary?.label || workspace}: ${c.files || 0} file(s) (~${contextPack.approxTokens || 0} tokens), ${c.diffs || 0} diff(s), ${c.priorFailures || 0} prior failure(s), ${c.screenshots || 0} screenshot(s); ${c.omitted || 0} section(s) omitted with source links.`
    );
  }

  if (channelContext) {
    appendLog(
      run,
      "channel",
      `Channel dispatch ${channelContext.channelName || channelContext.channelId}${channelContext.threadId ? ` thread ${channelContext.threadId}` : ""}; auto mode (self-judge) ${channelContext.autoModeDefault || channelContext.selfJudge ? "on" : "off"}.`
    );
    await recordChannelDispatch(channelContext, { prompt, agentId: run.agentId });
  }

  if (sdkTransportEnabled(payload, mode)) {
    try {
      await startSdkRun(run, payload, { workspace, prompt, agentRuntime });
      return runSummary(run);
    } catch (error) {
      run.transport = "cli";
      run.command = `autohand ${displayArgs.map(shellQuote).join(" ")}`;
      appendLog(run, "system", `${error.message}; falling back to direct CLI transport`);
    }
  } else if (!sdkSupportedMode(mode)) {
    appendLog(run, "system", `SDK transport not used for ${mode} mode; using direct CLI transport`);
  }

  startCliRun(run, args, workspace, agentRuntime, payload);

  return runSummary(run);
}

async function chatOnce(payload) {
  const controller = new AbortController();
  const unregister = registerChat(String(payload.agentId || payload.agent?.id || ''), controller);
  try {
    return await executeChatTurn(payload, { stream: { send() {} }, signal: controller.signal, startedAt: Date.now() });
  } finally { unregister(); }
}

async function streamChatWithCli({ payload, args, displayArgs, workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal }) {
  const command = `autohand ${displayArgs.map(shellQuote).join(" ")}`;
  let stdout = "";
  let stderr = "";

  stream.send("sdk", {
    type: "status",
    status: "cli_start",
    label: "Running local runtime...",
    timestamp: new Date().toISOString(),
  });

  const output = await new Promise((resolve, reject) => {
    let settled = false;
    let abortHandler = null;
    const child = spawn(resolveAutohandBinary() || "autohand", args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...agentRuntimeEnvVars(agentRuntime),
        FORCE_COLOR: "0",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    }

    function stopChildWithError(message) {
      stderr += `${stderr.endsWith("\n") || !stderr ? "" : "\n"}[Autohand Squad] ${message}\n`;
      terminateChildProcess(child);
      finish(null, {
        exitCode: null,
        stdout,
        stderr,
        error: message,
      });
    }

    const timer = setTimeout(() => {
      // Say what happened and what to try; "chat timed out waiting for
      // Autohand" left people guessing (bug hunt 2026-10, #44).
      const silent = !String(stdout || "").trim();
      stopChildWithError(`Autohand Code did not answer within ${Math.round(timeoutMs / 1000)} seconds${silent ? " and printed nothing" : ""}. Run \`autohand login\` in a terminal if you have not recently, check the model on this member's Model page, then Retry.`);
    }, timeoutMs);

    abortHandler = () => {
      stopChildWithError(stopMessage(signal));
    };
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      const delta = visibleCliStreamOutput(text, prompt);
      if (delta.trim()) {
        stream.send("sdk", {
          type: "message_delta",
          delta,
          timestamp: new Date().toISOString(),
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      stream.send("sdk", {
        type: "tool_update",
        toolId: "local-runtime",
        toolName: "local runtime",
        output: compactTraceText(text, 12000),
        stream: "stderr",
        timestamp: new Date().toISOString(),
      });
    });
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) => finish(null, { exitCode, stdout, stderr }));
  });

  const reply = formatChatReply(output.stdout, output.stderr, prompt);
  const trace = await buildChatTrace({
    agentHome: agentRuntime.agentHome,
    startedAt,
    stdout: output.stdout,
    stderr: output.stderr,
    prompt,
    command,
    exitCode: output.exitCode,
  });
  const completedAt = Date.now();
  trace.startedAt = new Date(startedAt).toISOString();
  trace.completedAt = new Date(completedAt).toISOString();
  trace.durationMs = completedAt - startedAt;
  trace.transport = "cli";
  const result = {
    reply: reply || "Autohand returned no chat text.",
    trace,
    workspace,
    command,
    transport: "cli",
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    durationMs: trace.durationMs,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    effectiveModel: agentRuntime.effectiveModel,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    channel: channelContextFromPayload(payload),
    contextLayers: chatContextLayers(payload, agentRuntime, trace),
  };
  if (output.error || output.exitCode !== 0) {
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "cli", status: "failed", trace, command }));
    throw new ChatRuntimeError(output.error || reply || `Autohand exited with code ${output.exitCode}`, result);
  }
  recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "cli", status: "completed", trace, command }));
  stream.send("done", result);
  return result;
}

// Resolves with `{ status, preview }` once the stream has ended: "completed"
// with the reply's first line, or "failed" with the error message, so the
// route can emit chat.finished with an honest status.
async function executeChatTurn(payload, { stream, signal, startedAt = Date.now() }) {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  const memberId = String(payload.agentId || payload.agent?.id || "");
  if (payload.collaboration?.role === "receiver" && (
    (activeChats.get(memberId)?.size || 0) > 1 ||
    sdkSessions?.stats().sessions.some(session => session.agentId === memberId && session.busy) ||
    [...runs.values()].some(run => run.agentId === memberId && isLiveRun(run))
  )) {
    const result = { declined: "busy", reply: `${payload.agent?.name || "The receiving member"} is already working on another request. Retry this checkpoint after that request finishes.`, workspace: payload.workspace || "", completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt };
    stream.send("done", result);
    return result;
  }
  payload = await withSavedMember(payload);
  const workId = randomUUID();
  // Always-on (ADR-0125): a person's message stops whatever the agenda
  // started for this member; the agenda route listens for this.
  emitBridgeEvent("chat.started", { memberId, requestId: String(payload.requestId || ""), person: isPersonTurn(payload), channelId: String(channelContextFromPayload(payload)?.id || "") });
  const actionContext = await agentChannelActions.begin(payload);
  const originalStream = stream;
  const liveEvidence = (data) => { if (data.runId === workId) originalStream.send("computer-use", { sessionId: data.sessionId, runId: workId, files: data.files }); };
  bridgeEvents.on("computer-use.evidence", liveEvidence);
  // Every turn is a run (ADR-0113): the Execution panel lists it whichever
  // engine answers, Stop there stops it, and the record survives a restart.
  const run = beginChatRun(payload, workId, startedAt);
  const forwardAbort = () => run.abortController?.abort();
  if (signal?.aborted) forwardAbort(); else signal?.addEventListener("abort", forwardAbort, { once: true });
  const runSignal = run.abortController.signal;
  const delayedDone = chatRunStream(run, { send(event, data) { if (event !== "done") originalStream.send(event, data); } });
  // The nudge the previous reply left (ADR-0125) rides on this turn's prompt
  // only, after the run recorded the person's own words; it is used once.
  const nudge = takeAutomationNudge(payload);
  if (nudge) run.automationNudge = { kind: nudge.kind, phrase: nudge.phrase };
  try {
    const result = await executeChatTurnInner({ ...payload, _computerUseWorkId: workId, ...(nudge ? { prompt: `${String(payload.prompt || "").trim()}\n\n${automationNudgeLine(nudge)}` } : {}) }, { stream: delayedDone, signal: runSignal, startedAt });
    const evidence = await finishComputerWork(workId);
    const finished = await agentChannelActions.finish(actionContext, { ...cleanWorkResult(result), ...(evidence ? { computerUse: evidence } : {}) }, runSignal);
    const completed = withTeamReceipts(finished, team.takeReceipts(workId));
    const scheduleOffer = scheduleOfferFor(payload, completed);
    if (scheduleOffer) {
      completed.scheduleOffer = scheduleOffer;
      logEvent(SEVERITY.INFO, `schedule offered for ${memberId}: ${scheduleOffer.description} ("${scheduleOffer.phrase}")`, { "event.name": "work.schedule.offered", "autohand.member.id": memberId, "autohand.work.phrase": scheduleOffer.phrase });
    }
    noteAutomationNudge(payload, completed, workId);
    finishChatRun(run, { result: completed });
    originalStream.send("done", completed);
    return completed;
  } catch (error) {
    finishChatRun(run, { error, aborted: runSignal.aborted });
    throw error;
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
    await finishComputerWork(workId).catch(() => {});
    await finishVaultWork(workId).catch(() => {});
    await finishTeamWork(workId).catch(() => {});
    team.takeReceipts(workId);
    bridgeEvents.off("computer-use.evidence", liveEvidence);
  }
}

// Team tool receipts (ADR-0134) join the turn's SQUAD_ACTION receipts, so the
// browser applies a rename or shows a schedule proposal whichever way it came.
// Profile receipts are lifted out of the reply by the browser; the others add
// one quiet line each.
function withTeamReceipts(result, receipts = []) {
  if (!receipts.length) return result;
  const lines = receipts.filter((receipt) => receipt?.message && receipt.type !== "team_message").map((receipt) => receipt.message);
  return { ...result, reply: [String(result.reply || "").trim(), ...lines].filter(Boolean).join("\n\n"), channelActions: [...(Array.isArray(result.channelActions) ? result.channelActions : []), ...receipts] };
}

function beginChatRun(payload, workId, startedAt) {
  const assignment = harnessAssignmentFromAgent(payload.agent);
  const prompt = String(payload.prompt || "").replace(/\s+/g, " ").trim();
  const run = {
    id: workId,
    agentId: String(payload.agentId || payload.agent?.id || ""),
    title: prompt.length > 140 ? `${prompt.slice(0, 139)}…` : prompt || "Chat",
    prompt,
    mode: "chat",
    kind: "chat",
    channel: channelContextFromPayload(payload),
    recipeId: null,
    canvasId: null,
    workspace: String(payload.workspace || ""),
    effectiveModel: null,
    transport: isExternalHarness(assignment) ? assignment.id : "sdk",
    harness: assignment.id,
    harnessVersion: "",
    command: "",
    logPath: join(runLogsDir, `${workId}.otlp.jsonl`),
    status: "running",
    exitCode: null,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    contextPack: null,
    contextLayers: null,
    logs: [],
    abortController: new AbortController(),
    // What a retry re-sends through the member's queue if this turn is cut
    // short by a bridge restart (ADR-0123). Direct turns only: goals, queue
    // items, routines and channel turns have their own recovery.
    launch: retryLaunch(payload),
  };
  runs.set(workId, run);
  runHistory.persist();
  return run;
}

function retryLaunch(payload) {
  if (!payload || payload.goalId || payload.goal || payload.mode === "goal") return null;
  if (channelContextFromPayload(payload)) return null;
  if (/^(queue|goal|routine|observer)-/.test(String(payload.requestId || ""))) return null;
  if (payload.collaboration) return null;
  return privateLaunch({ ...payload, model: payload.model || "", effort: payload.effort || "", access: payload.access || "" });
}

// The chat stream carries the browser's event shapes (message_delta, tool
// objects); the run log keeps the same row kinds the Execution feed reads.
function chatRunStream(run, stream) {
  return {
    send(event, data) {
      if (event === "start" && data && typeof data === "object") {
        if (data.workspace) run.workspace = String(data.workspace);
        if (data.effectiveModel) run.effectiveModel = data.effectiveModel;
        if (data.harnessVersion) run.harnessVersion = String(data.harnessVersion);
      } else if (event === "sdk" && data && typeof data === "object") {
        appendChatRunEvent(run, data);
      }
      stream.send(event, data);
    },
  };
}

function appendChatRunEvent(run, event) {
  if (run.logs.length >= 4000) return;
  switch (event.type) {
    case "message_end":
      if (event.content) appendLog(run, "stdout", event.content);
      return;
    case "tool_start":
      appendLog(run, "tool", `started ${event.tool?.name || "tool"} ${compactJson(event.tool?.args || {}, 4000)}`);
      return;
    case "tool_update":
      if (event.output) appendLog(run, event.stream === "stderr" ? "stderr" : "stdout", event.output);
      return;
    case "tool_end":
      appendLog(run, "tool", `${event.toolName || "tool"} ${event.success === false ? "failed" : "completed"} at ${event.timestamp || new Date().toISOString()}`);
      if (event.output) appendLog(run, event.stream === "stderr" ? "stderr" : "stdout", event.output);
      return;
    case "permission_request":
      appendLog(run, "permission", `${event.title || "Permission requested"}${event.content ? `: ${event.content}` : ""}`);
      return;
    case "error":
      appendLog(run, "stderr", event.error || "Agent stream failed");
      return;
    case "status":
      if (event.label) appendLog(run, "system", event.label);
      return;
    default:
      return;
  }
}

function finishChatRun(run, { result = null, error = null, aborted = false } = {}) {
  if (!run) return;
  const stoppedAlready = run.status === "stopped";
  if (!stoppedAlready && !isLiveRun(run)) return;
  const finishedAt = new Date().toISOString();
  if (result) {
    run.command = String(result.command || run.command || "");
    run.reply = String(result.reply || "");
    run.trace = result.trace || run.trace || null;
    run.workspace = String(result.workspace || run.workspace || "");
    if (result.effectiveModel) run.effectiveModel = result.effectiveModel;
    if (result.harnessVersion) run.harnessVersion = String(result.harnessVersion);
    run.sessionId = String(result.sessionId || "");
    run.durationMs = Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : Date.parse(finishedAt) - Date.parse(run.startedAt);
    run.channelActions = Array.isArray(result.channelActions) ? result.channelActions : [];
    // The chat result carries the context manifest (recall layer included);
    // the run shows the same one in the Execution panel.
    if (result.contextLayers && typeof result.contextLayers === "object") run.contextLayers = result.contextLayers;
    run.status = result.declined ? "stopped" : "completed";
    run.exitCode = result.declined ? null : 0;
  } else {
    const details = error instanceof ChatRuntimeError ? error.details : null;
    if (details?.command) run.command = String(details.command);
    if (details?.trace) run.trace = details.trace;
    if (details?.sessionId) run.sessionId = String(details.sessionId);
    run.durationMs = Date.parse(finishedAt) - Date.parse(run.startedAt);
    run.status = stoppedAlready || aborted || isAbortError(error) ? "stopped" : "failed";
    run.exitCode = run.status === "failed" ? 1 : null;
    if (error && run.status === "failed") appendLog(run, "stderr", error.message || String(error));
  }
  run.finishedAt = finishedAt;
  run.finishedEventAt = finishedAt; // chat.finished already reaches the audit trail; no run.finished here
  appendLog(run, "system", `${run.harness || "member"} reply ${run.status}`);
  run.abortController = null;
  run.launch = null; // a finished turn is never retried from the Runs tab
  runHistory.persist();
}

// Recall (ADR-0115): the block a member receives about earlier conversations.
// Direct-message turns only; a channel turn already carries its thread.
function recallInstructions(payload) {
  const text = payload?._recall?.text;
  return typeof text === "string" && text ? text : "";
}

// Work plans (ADR-0124). Two parts, both bridge-owned so every engine and
// every entry point (app, queue, Telegram, control plane, routine run) gets
// them: the task and schedule action formats when the profile the caller
// sent lacks them (the app's own profile already carries both; the browser
// cuts nothing, but this site slices the profile at 12,000 characters, and a
// Telegram turn uses the saved member profile, which never had them), and
// "Your work plan" on direct-message turns.
function bridgeTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// The part of the browser's profile that reaches the engine: every builder
// cuts it at 12000 characters, so a format at its end may not have survived.
function sentProfile(payload) {
  return String(payload?.profile || "").trim().slice(0, 12000);
}

function workPlanInstructions(payload) {
  const base = sentProfile(payload);
  const parts = [];
  if (!base.includes('"type":"task"')) parts.push(taskActionInstruction());
  if (!base.includes('"type":"schedule"')) parts.push(scheduleActionInstruction(bridgeTimeZone()));
  const plan = payload?._workPlan?.text;
  if (typeof plan === "string" && plan) parts.push(plan);
  return parts.join("\n\n");
}

// A member born in conversation (ADR-0126): a member with no role is told to
// become what the person asks and to record it with a `profile` action; a
// member with a role hears the same only on a turn that asks for a new one.
// Bridge-owned like the work-plan instructions, so every engine and entry
// point gets it; direct-message turns only, since the browser applies the
// receipt from its own chat stream.
function memberShapingInstructions(payload) {
  if (channelContextFromPayload(payload) || payload?.collaboration) return "";
  if (sentProfile(payload).includes('"type":"profile"')) return "";
  // A turn with no member description (the app's own designer, a bare API
  // call) is not a blank member; only a described member can be shaped.
  const agent = payload?.agent && typeof payload.agent === "object" && !Array.isArray(payload.agent) ? payload.agent : null;
  if (!agent || !String(agent.name || "").trim() || utilityAgentIds.has(String(payload.agentId || agent.id || ""))) return "";
  return needsShapingInstruction(agent, payload?.prompt) ? memberShapingInstruction(agent) : "";
}

async function workPlanForTurn(payload) {
  if (channelContextFromPayload(payload)) return null;
  const memberId = sanitizeAgentId(payload.agentId || payload.agent?.id || "");
  try {
    return await workPlanFor({ memberId, squadStateDir, goals, memberName: payload.agent?.name || "" });
  } catch (error) {
    logEvent(SEVERITY.DEBUG, `work plan skipped for ${memberId}: ${error?.message || error}`, { "event.name": "chat.work_plan.skipped", "autohand.member.id": memberId });
    return null;
  }
}

// The bridge-side safety net (ADR-0124 §4): the person named recurring work
// and the reply proposed no schedule, so the chat offers "Schedule this?"
// with a schedule read from the phrase. Nothing is created here.
function scheduleOfferFor(payload, result) {
  if (!result || result.declined || channelContextFromPayload(payload) || payload.collaboration) return null;
  if (replyProposedSchedule(result.channelActions)) return null;
  const found = detectRecurringWork(payload.prompt);
  if (!found) return null;
  const timeZone = bridgeTimeZone();
  const schedule = normalizeSchedule({ ...found.schedule, timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC" });
  if (validateSchedule(schedule).length) return null;
  return { phrase: found.phrase, title: found.title, instructions: found.instructions, schedule, timeZone: schedule.timeZone, description: describeSchedule(schedule) };
}

// Always-on (ADR-0125). A turn is the person's when it is a direct message
// they typed (or queued): not a channel, goal, routine, observer, handoff,
// agenda or draft turn.
function isPersonTurn(payload) {
  if (!payload || payload.collaboration || payload.goalId || payload.goal || payload.mode === "goal") return false;
  if (channelContextFromPayload(payload)) return false;
  return !/^(goal|routine|observer|agenda|draft|run)-/.test(String(payload.requestId || ""));
}

// The next-turn nudge: when the person's message reads as repeating work and
// the reply proposed no routine, the member's next turn carries one line
// asking it to propose or ask. In memory: a bridge restart forgets it, and
// it expires after a day. "Schedule this?" (ADR-0124) is unchanged.
const automationNudges = new Map();
const AUTOMATION_NUDGE_TTL_MS = 24 * 60 * 60_000;

function previousPersonPrompts(memberId, excludeId) {
  const since = Date.now() - 14 * 24 * 60 * 60_000;
  return [...runs.values()]
    .filter((run) => run.id !== excludeId && run.agentId === memberId && run.kind === "chat" && run.status === "completed" && !run.channel && Date.parse(run.startedAt) >= since && run.prompt)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, 40)
    .map((run) => run.prompt);
}

function noteAutomationNudge(payload, result, workId) {
  const memberId = String(payload.agentId || payload.agent?.id || "");
  if (!memberId || !isPersonTurn(payload) || !result || result.declined) return;
  if (replyProposedSchedule(result.channelActions)) {
    automationNudges.delete(memberId);
    return;
  }
  const signal = repeatedWorkSignal(payload.prompt, previousPersonPrompts(memberId, workId));
  if (!signal) return;
  automationNudges.set(memberId, { ...signal, at: Date.now() });
  logEvent(SEVERITY.INFO, `automation nudge noted for ${memberId} (${signal.kind}: "${signal.phrase}")`, { "event.name": "work.automation.nudge_noted", "autohand.member.id": memberId, "autohand.work.signal": signal.kind });
}

function takeAutomationNudge(payload) {
  const memberId = String(payload.agentId || payload.agent?.id || "");
  const nudge = automationNudges.get(memberId);
  if (!nudge || !isPersonTurn(payload)) return null;
  automationNudges.delete(memberId);
  return Date.now() - nudge.at <= AUTOMATION_NUDGE_TTL_MS ? nudge : null;
}

async function recallForTurn(payload) {
  if (channelContextFromPayload(payload)) return null;
  const memberId = sanitizeAgentId(payload.agentId || payload.agent?.id || "");
  try {
    const sources = await collectRecallSources({ memberId, store: chatStore, runs, readChannelsState, readStatus: () => readOptionalJsonFile(liveStatusPath) });
    return buildRecall(sources);
  } catch (error) {
    logEvent(SEVERITY.DEBUG, `recall skipped for ${memberId}: ${error?.message || error}`, { "event.name": "chat.recall.skipped", "autohand.member.id": memberId });
    return null;
  }
}

async function executeChatTurnInner(payload, { stream, signal, startedAt = Date.now() }) {
  if (signal?.aborted) throw new Error(stopMessage(signal));
  await memberAvailability.assertCanWork(payload);
  payload = { ...payload, _recall: await recallForTurn(payload), _workPlan: await workPlanForTurn(payload) };
  stream = withWorkProgress(stream);
  let result;
  if (isExternalHarness(harnessAssignmentFromAgent(payload.agent))) {
    result = await streamChatWithExternalHarness(payload, { stream, signal, startedAt });
    return cleanWorkResult(result);
  }
  const { args, displayArgs, workspace, prompt, agentRuntime } = await autohandArgs({ ...payload, mode: "prompt", dryRun: false });
  if (!prompt) throw new Error("prompt is required");
  assertAutohandAuth(agentRuntime);
  if (signal?.aborted) throw new Error(stopMessage(signal));
  const channelContext = channelContextFromPayload(payload);
  if (channelContext) await recordChannelDispatch(channelContext, { prompt, agentId: payload.agentId || agentRuntime.agentId });
  const requestedTimeout = Number(payload.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 15000), 300000) : 180000;
  stream.send("start", { startedAt: new Date(startedAt).toISOString(), workspace, effectiveModel: agentRuntime.effectiveModel, channel: channelContext });
  const sdkPayload = { ...payload, mode: "prompt", dryRun: false };
  if (sdkTransportEnabled(sdkPayload, "prompt")) {
    try {
      result = await streamChatWithSdk(sdkPayload, { workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal });
      return cleanWorkResult(result);
    } catch (error) {
      if (!(error instanceof SdkBridgeStartupError)) throw error;
      stream.send("sdk", { type: "status", status: "cli_fallback", label: "SDK bridge was unavailable; using CLI transport...", timestamp: new Date().toISOString() });
    }
  }
  result = await streamChatWithCli({ payload, args, displayArgs, workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal });
  return cleanWorkResult(result);
}

async function streamChat(payload, res) {
  if (desktopInstallLocked) throw Object.assign(new Error("Squad is installing an update."), { status: 503 });
  const stream = startEventStream(res);
  const startedAt = Date.now();
  const controller = new AbortController();
  const unregister = registerChat(String(payload.agentId || payload.agent?.id || ''), controller);
  let streamOpen = true;
  const abortStream = () => { if (streamOpen && !controller.signal.aborted) controller.abort(clientClosedReason()); };
  res.on("close", abortStream);
  try {
    const result = await executeChatTurn(payload, { stream, signal: controller.signal, startedAt });
    return { status: "completed", preview: String(result?.reply || "").slice(0, 140) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stream.send("error", { error: message, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
      ...(error instanceof ChatRuntimeError && error.details ? cleanWorkResult(error.details) : {}) });
    // A turn the person stopped, or whose page closed, did not fail: saying
    // "failed" raised a "could not reply" notification for their own Stop.
    return { status: controller.signal.aborted ? "stopped" : "failed", preview: message.slice(0, 140) };
  } finally {
    streamOpen = false; res.off("close", abortStream); unregister(); stream.end();
  }
}

async function streamGoal(payload, res) {
  // Start only after all request validation. A disconnected browser detaches
  // this listener; it does not cancel the persisted pursuit.
  const goal = await goals.start(payload);
  const stream = startEventStream(res);
  return new Promise((resolve) => {
    let detached = false;
    let unsubscribe = () => {};
    const detach = () => { if (detached) return; detached = true; unsubscribe(); res.off("close", detach); resolve(); };
    unsubscribe = goals.subscribe(goal.id, ({ event, data }) => {
      if (detached) return;
      stream.send(event, data);
      if (event === "done") { stream.end(); detach(); }
    });
    res.on("close", detach);
    stream.send("goal", goal);
  });
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

async function openTerminal(payload) {
  const workspace = await cleanWorkspace(payload.workspace);
  const prompt = String(payload.prompt || "").trim();
  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const agentRuntime = await ensureAgentRuntime(payload, workspace);
  const profileArgs = profile ? ` --append-sys-prompt ${shellQuote(profile)}` : "";
  const profileDirArgs = agentRuntime.profileDocs?.path ? ` --add-dir ${shellQuote(agentRuntime.profileDocs.path)}` : "";
  const noIdleLogoutArg = autohandSupportsFlag("--no-idle-logout") ? " --no-idle-logout" : "";
  const envPrefix = `AUTOHAND_HOME=${shellQuote(agentRuntime.agentHome)} AUTOHAND_CONFIG=${shellQuote(agentRuntime.configPath)} AUTOHAND_CLIENT_NAME=${shellQuote(`autohand-squad-${agentRuntime.agentId}`)} AUTOHAND_NO_IDLE_LOGOUT=1`;
  const autohandBinary = resolveAutohandBinary() || "autohand";
  const baseCommand = `${envPrefix} ${shellQuote(autohandBinary)} --path ${shellQuote(workspace)} --config ${shellQuote(agentRuntime.configPath)}${noIdleLogoutArg}${profileDirArgs}${profileArgs}`;
  const command = prompt
    ? `cd ${shellQuote(workspace)} && ${baseCommand} --prompt ${shellQuote(prompt)}`
    : `cd ${shellQuote(workspace)} && ${baseCommand}`;
  const script = [
    'tell application "Terminal"',
    `do script ${JSON.stringify(command)}`,
    "activate",
    "end tell",
  ];
  if (process.platform !== "darwin") {
    throw new Error(`Open in Terminal is only available on macOS. Run this in your shell instead:\n${command}`);
  }
  const result = spawnSync("osascript", script.flatMap((line) => ["-e", line]), {
    cwd: workspace,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.error) {
    throw new Error(`could not open Terminal: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(String(result.stderr || "").trim() || "could not open Terminal");
  }
  return {
    command,
    workspace,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    effectiveModel: agentRuntime.effectiveModel,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
  };
}

// Bridge context handed to route plug-ins (docs/integration/CONTRACT.md).
function routeContext() {
  return {
    rootDir,
    squadStateDir,
    appStateDir,
    squadWorkspaceRoot,
    homeDir,
    packageMetadata,
    json,
    readBody,
    startEventStream,
    logEvent,
    SEVERITY,
    readJsonFile,
    readOptionalJsonFile,
    writeJsonFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    },
    runs,
    // Finished runs written through route plug-ins too (ADR-0127).
    persistRuns: () => runHistory.persist(),
    goals,
    projectObserver,
    availability: memberAvailability,
    executeTurn: executeBridgeTurn,
    registerChat,
    isMemberBusy,
    modelContextWindow: ({ provider = "", model = "" } = {}) => {
      const id = String(model || "").trim();
      if (!id) return 0;
      // Only the Autohand AI catalog carries window sizes today; other
      // providers report none, and no window means no gauge.
      if (provider && provider !== "autohandai") return 0;
      return Number(autohandAiModels().find((entry) => entry.id === id)?.contextWindow) || 0;
    },
    computerUse,
    vault,
    team,
    authorizeComputerUseGrant,
    connectors,
    firecrawlBaseUrl,
    stopChats,
    runSummary,
    isLiveRun,
    get sdkSessions() {
      return sdkSessions;
    },
    readChannelsState,
    writeChannelsState,
    mutateChannelsState,
    agentChannelActions,
    startRun,
    // Stop a live run the bridge started (routine run limits, ADR-0110).
    // Same path as POST /api/runs/:id/stop; false when the run is not live.
    stopRun: async (runId, reason = "stopped") => {
      const run = runs.get(String(runId || ""));
      return run && isLiveRun(run) ? stopRun(run, reason) : false;
    },
    events: bridgeEvents,
    emit: emitBridgeEvent,
    getRuntime,
    cleanWorkspace,
    spawnSync,
    // Member homes: <agentsDir>/<member id>/{skills,profile}. Read-only use
    // by team export (server/teams, ADR-0106); provisioning stays here.
    agentsDir: isolatedAgentsDir,
  };
}

async function handleApi(req, res, url) {
  if (await handlePluginRoute(req, res, url, routeContext())) return true;

  // Client-side happenings (handoffs, approvals, mentions) reach the bridge
  // event bus here so notifications and the audit trail can act on them.
  if (url.pathname === "/api/events" && req.method === "POST") {
    const payload = await readBody(req);
    const name = String(payload.name || "").trim();
    if (!/^[a-z]+(\.[a-z_]+)+$/.test(name)) {
      json(res, 400, { success: false, error: "event name must look like handoff.pending" });
      return true;
    }
    const { name: _ignored, ...rest } = payload;
    json(res, 200, { success: true, data: emitBridgeEvent(name, rest) });
    return true;
  }

  if (url.pathname === "/api/runtime" && req.method === "GET") {
    json(res, 200, { success: true, data: getRuntime() });
    return true;
  }

  if (url.pathname === "/api/harnesses" && req.method === "GET") {
    try {
      const refresh = url.searchParams.get("refresh") === "1";
      const harnesses = await listHarnesses({ refresh, contextFor: harnessContextFor });
      json(res, 200, { success: true, data: { default: DEFAULT_HARNESS_ID, harnesses: harnesses.map(publicReadiness) } });
    } catch (error) {
      json(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  // Warm a member's SDK session before the first message. sdk.start() returns
  // at spawn, so the CLI finishes booting while the person is still typing;
  // without this the first message of a conversation pays the full cold start
  // (42 s measured against 4 s warm, ADR-0030).
  if (url.pathname === "/api/chat/warm" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const agentId = sanitizeAgentId(payload.agentId || payload.agent?.id || "");
      // The pool is created on first use, so do not test the lazy handle here:
      // acquireSdkLease builds it. Only a missing member is a reason to stop.
      if (!agentId) {
        json(res, 200, { success: true, data: { agentId, warmed: false } });
        return true;
      }
      const workspace = await cleanWorkspace(String(payload.workspace || "") || getDefaultWorkspace());
      const agentRuntime = await ensureAgentRuntime({ ...payload, agentId }, workspace);
      if (isExternalHarness(agentRuntime.harness)) {
        json(res, 202, { success: true, data: { agentId, warmed: false, reason: "external_harness", harness: agentRuntime.harness.id } });
        return true;
      }
      const profile = String(payload.profile || "").trim().slice(0, 12000);
      const context = sdkRuntimeContext({ ...payload, agentId }, workspace, profile, agentRuntime);
      // Answer immediately: warming is best effort and must never make the
      // person wait on the thing it exists to avoid.
      json(res, 202, { success: true, data: { agentId, warmed: true } });
      acquireSdkLease({ ...payload, agentId }, workspace, context)
        .then((lease) => lease?.release?.(true))
        .catch((error) => {
          logEvent(SEVERITY.DEBUG, `warm-up for ${agentId} did not start a session: ${error?.message || error}`, {
            "event.name": "chat.warm.failed",
            "autohand.member": agentId,
          });
        });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/chat/reset" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const agentId = sanitizeAgentId(payload.agentId || payload.agent?.id || "");
      const closed = sdkSessions && agentId ? await sdkSessions.reset(agentId, "new conversation") : 0;
      // Claude Code and Codex resume by id; a new chat must forget those
      // ids too, or the "new" conversation continues the old one (ADR-0113).
      const forgotten = agentId ? await clearHarnessSessions(join(isolatedAgentsDir, agentId)).catch(() => 0) : 0;
      json(res, 200, { success: true, data: { agentId, closed, forgotten } });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/sessions" && req.method === "GET") {
    json(res, 200, { success: true, data: sdkSessions ? sdkSessions.stats() : { active: 0, busy: 0, sessions: [] } });
    return true;
  }

  if (url.pathname === "/api/sessions" && req.method === "DELETE") {
    const closed = sdkSessions ? await sdkSessions.closeAll("closed by user") : 0;
    sdkSessions = null;
    json(res, 200, { success: true, data: { closed } });
    return true;
  }

  // Browser sign-in for a harness account. The vendor CLI runs its own flow;
  // the bridge only relays the URL / device code and the outcome.
  if (url.pathname === "/api/account/logout" && req.method === "POST") {
    try {
      json(res, 200, { success: true, data: await signOutAccount() });
    } catch (error) {
      json(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/harnesses/login" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const id = normalizeHarnessAssignment({ id: payload.id }).id;
      let executable = "";
      let args;
      let env = {};
      let opensBrowser;
      if (id === "autohand") {
        // `autohand login` needs a terminal (it asks for the code). The Squad
        // CLI (`squad login`, bundled with the desktop app) or the launcher's
        // login action run the same device flow headlessly, open the browser,
        // and store the account for both Squad and the CLI.
        const squadCli = locateSquadCliBinary();
        if (squadCli) {
          executable = squadCli;
          args = ["login"];
        } else {
          executable = locateSquadTrayBinary();
          args = ["--action", "login"];
        }
        if (!executable) {
          throw new Error("Neither the Squad CLI nor the launcher binary was found, so browser sign-in cannot start. Run `autohand login` in a terminal instead.");
        }
        env = { AUTOHAND_SQUAD_HOME: squadStateDir };
        opensBrowser = true;
      } else {
        const readiness = await detectHarness(id, { refresh: false, context: harnessContextFor(id) });
        executable = readiness.executablePath || "";
      }
      const flow = harnessLogins.start(id, { executable, args, env, cwd: rootDir, opensBrowser });
      logEvent(SEVERITY.INFO, `harness sign-in started: ${id}`, { "event.name": "harness.login.started", "autohand.harness": id });
      json(res, 200, { success: true, data: flow });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/harnesses/login" && req.method === "GET") {
    const id = normalizeHarnessAssignment({ id: url.searchParams.get("id") }).id;
    const flow = harnessLogins.status(id);
    let readiness = null;
    if (flow.state === "done") {
      readiness = publicReadiness(await detectHarness(id, { refresh: true, context: harnessContextFor(id) }));
    }
    json(res, 200, { success: true, data: { ...flow, readiness, account: id === "autohand" ? readRuntimeAccount() : undefined } });
    return true;
  }

  if (url.pathname === "/api/harnesses/login" && req.method === "DELETE") {
    const id = normalizeHarnessAssignment({ id: url.searchParams.get("id") }).id;
    json(res, 200, { success: true, data: { cancelled: harnessLogins.cancel(id) } });
    return true;
  }

  // Use the bridge opener: target=_blank is dropped by the main desktop webview.
  // Only the active CLI flow chooses the URL; the caller cannot supply one.
  if (url.pathname === "/api/harnesses/login/open" && req.method === "POST") {
    const id = normalizeHarnessAssignment({ id: url.searchParams.get("id") }).id;
    const flow = harnessLogins.status(id);
    if (flow.state !== "running" || !flow.url) {
      json(res, 409, { success: false, error: "No sign-in is waiting. Start sign-in again." });
      return true;
    }
    try {
      await openSignInUrl(flow.url);
      json(res, 200, { success: true, data: { opened: true } });
    } catch (error) {
      json(res, 502, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/harnesses/test" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const assignment = normalizeHarnessAssignment(payload);
      const readiness = await detectHarness(assignment.id, {
        explicitPath: assignment.executablePath,
        refresh: true,
        context: harnessContextFor(assignment.id),
      });
      json(res, 200, { success: true, data: publicReadiness(readiness) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/setup/runtime" && req.method === "POST") {
    json(res, 202, { success: true, data: cliBootstrap.prepare() });
    return true;
  }

  if (url.pathname === "/api/setup/login" && req.method === "POST") {
    try {
      json(res, 200, { success: true, data: requestSquadBrowserLogin() });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/workspaces" && req.method === "GET") {
    json(res, 200, { success: true, data: await listWorkspaces() });
    return true;
  }

  if (url.pathname === "/api/workspace-files" && req.method === "GET") {
    try {
      const workspace = url.searchParams.get("workspace") || getDefaultWorkspace();
      const query = url.searchParams.get("q") || "";
      json(res, 200, { success: true, data: await listWorkspaceFiles(workspace, query) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/analytics" && req.method === "GET") {
    json(res, 200, { success: true, data: await analyticsSnapshot() });
    return true;
  }

  if (url.pathname === "/api/status/snapshot" && req.method === "GET") {
    json(res, 200, { success: true, data: (await readOptionalJsonFile(liveStatusPath)) || null });
    return true;
  }

  if (url.pathname === "/api/status/snapshot" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await writeLiveStatusSnapshot(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/feedback/screenshot" && req.method === "POST") {
    try {
      const payload = await readBody(req, 5 * 1024 * 1024);
      const route = normalizeFeedbackRoute(payload.route);
      const [screenshot, diagnostics] = await Promise.all([
        captureFeedbackScreenshot({
          route,
          storage: payload.storage || {},
        }),
        collectFeedbackContext(route),
      ]);
      json(res, 200, { success: true, data: { screenshot, diagnostics } });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/feedback/squad" && req.method === "POST") {
    try {
      const payload = await readBody(req, 14 * 1024 * 1024);
      json(res, 200, { success: true, data: await submitSquadFeedback(payload) });
    } catch (error) {
      json(res, 502, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/memory-inbox" && req.method === "GET") {
    json(res, 200, { success: true, data: await readMemoryInboxState() });
    return true;
  }

  if (url.pathname === "/api/memory-inbox" && (req.method === "POST" || req.method === "PUT")) {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await writeMemoryInboxState(payload) });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/channels" && req.method === "GET") {
    json(res, 200, { success: true, data: await readChannelsState() });
    return true;
  }

  // Merge cached data without replacing another window's channels. Explicit
  // DELETE tombstones prevent old caches reviving deleted channels.
  if (url.pathname === "/api/channels/sync" && req.method === "PUT") {
    try {
      json(res, 200, { success: true, data: await channelsStore.sync(await readBody(req, CHANNEL_HISTORY_MAX_BYTES)) });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/channels" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 201, { success: true, data: await createChannel(payload) });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  // Snapshot sync used by the web app bridge (same contract as memory-inbox):
  // the client PUTs its full channel/thread state after local changes.
  if (url.pathname === "/api/channels" && req.method === "PUT") {
    try {
      const payload = await readBody(req, CHANNEL_HISTORY_MAX_BYTES);
      json(res, 200, { success: true, data: await writeChannelsState(payload) });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  // Responder rules (ADR-0108). Availability tells the settings row whether
  // Auto can run; pick decides one message's recipients and is the only place
  // the model is asked. Mentions never reach it.
  if (url.pathname === "/api/responders/availability" && req.method === "GET") {
    json(res, 200, { success: true, data: await responderPicker.availability() });
    return true;
  }

  const responderPickMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/responders\/pick$/);
  if (responderPickMatch && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const state = await readChannelsState();
      const channel = state.channels.find((item) => item.id === decodeURIComponent(responderPickMatch[1]));
      if (!channel) {
        json(res, 404, { success: false, error: "channel not found" });
        return true;
      }
      const message = String(payload.message || "").trim();
      if (!message) {
        json(res, 400, { success: false, error: "message is required" });
        return true;
      }
      const roster = responderRoster(channel, state, payload.members);
      const lines = Array.isArray(payload.lines) ? payload.lines.map((line) => String(line || "")).filter(Boolean).slice(-6) : responderRecentLines(channel, state);
      const decision = await responderPicker.pick({ channel, roster, message, lines });
      json(res, 200, { success: true, data: { ...decision, status: responderStatus(channel, { autoUnavailable: decision.available === false ? decision.reason : "" }) } });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
  if (channelMatch && (req.method === "PATCH" || req.method === "PUT")) {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await updateChannel(decodeURIComponent(channelMatch[1]), payload) });
    } catch (error) {
      json(res, error.status || (error.message === "channel not found" ? 404 : 400), { success: false, error: error.message });
    }
    return true;
  }

  if (channelMatch && req.method === "DELETE") {
    try {
      json(res, 200, { success: true, data: await deleteChannel(decodeURIComponent(channelMatch[1])) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  const channelMembersMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/members$/);
  if (channelMembersMatch && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await updateChannelMembers(decodeURIComponent(channelMembersMatch[1]), payload) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  const channelThreadsMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/threads$/);
  if (channelThreadsMatch && req.method === "GET") {
    const channelId = decodeURIComponent(channelThreadsMatch[1]);
    const state = await readChannelsState();
    if (!state.channels.some((channel) => channel.id === channelId)) {
      json(res, 404, { success: false, error: "channel not found" });
      return true;
    }
    json(res, 200, { success: true, data: state.threads.filter((thread) => thread.channelId === channelId) });
    return true;
  }

  if (channelThreadsMatch && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 201, { success: true, data: await recordChannelThread(decodeURIComponent(channelThreadsMatch[1]), payload) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/provider-settings" && req.method === "GET") {
    json(res, 200, { success: true, data: await readProviderSettings() });
    return true;
  }

  if (url.pathname === "/api/provider-settings" && (req.method === "POST" || req.method === "PUT")) {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await saveProviderSettingsPatch(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/provider-settings/test" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await testProviderSettings(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/shutdown" && req.method === "POST") {
    const result = await stopManagedRuns("Autohand Squad service stopped");
    json(res, 200, { success: true, data: result });
    shutdownServer();
    return true;
  }

  if (url.pathname === "/api/agents/provision" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const workspace = await cleanWorkspace(payload.workspace);
      const agentRuntime = await ensureAgentRuntime(payload, workspace);
      json(res, 200, {
        success: true,
        data: {
          agentId: agentRuntime.agentId,
          agentHome: agentRuntime.agentHome,
          configPath: agentRuntime.configPath,
          displayConfigPath: agentRuntime.displayConfigPath,
          profilePath: agentRuntime.profilePath,
          profileDocs: agentRuntime.profileDocs,
          effectiveModel: agentRuntime.effectiveModel,
          skillInstall: agentRuntime.skillInstall,
          harness: agentRuntime.harness,
        },
      });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/runs" && req.method === "GET") {
    json(res, 200, {
      success: true,
      data: Array.from(runs.values()).map(runSummary).reverse(),
    });
    return true;
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    try {
      const payload = withRemoteDefaultWorkspace(req, await readBody(req));
      await memberAvailability.assertCanWork(payload);
      const remote = await resolveRemote(routeContext(), payload.agentId, { req });
      const pursuingGoal = payload.mode === "goal" || payload.goal === true;
      if (remote && pursuingGoal) throw Object.assign(new Error("Persistent goals for remote members are not supported by this bridge. Start the goal on the member's own machine."), { status: 409 });
      if (remote) {
        await proxyChatOnce(remote, payload, res);
        return true;
      }
      if (pursuingGoal) {
        const goal = await goals.start(payload);
        json(res, 201, { success: true, data: { reply: "Goal started.", goal, goalId: goal.id } });
        return true;
      }
      const reply = await chatOnce(payload);
      emitBridgeEvent("chat.finished", { memberId: String(payload.agentId || ""), status: "completed", channelId: String(payload.channelId || payload.channel?.id || ""), preview: String(reply?.reply || reply?.output || "").slice(0, 140) });
      json(res, 200, { success: true, data: reply });
    } catch (error) {
      if (error.reason === "break") {
        json(res, 200, { success: true, data: { reply: error.reply, declined: true, reason: "break", agentId: error.memberId } });
        return true;
      }
      emitBridgeEvent("chat.finished", { memberId: "", status: "failed", preview: String(error?.message || "").slice(0, 140) });
      // Runtime failures carry the partial reply and trace exactly like the
      // streaming route's error event; a 502 marks the harness, not the caller.
      const status = error instanceof ChatRuntimeError ? 502 : error instanceof HarnessNotReadyError ? 409 : error.status || 400;
      json(res, status, {
        success: false,
        error: error.message,
        ...(error instanceof ChatRuntimeError && error.details ? { data: cleanWorkResult(error.details) } : {}),
        ...(error instanceof HarnessNotReadyError ? { harness: publicReadiness(error.readiness) } : {}),
      });
    }
    return true;
  }

  if (url.pathname === "/api/chat/stream" && req.method === "POST") {
    try {
      const payload = withRemoteDefaultWorkspace(req, await readBody(req));
      await memberAvailability.assertCanWork(payload);
      const remote = await resolveRemote(routeContext(), payload.agentId, { req });
      const pursuingGoal = payload.mode === "goal" || payload.goal === true;
      if (remote && pursuingGoal) throw Object.assign(new Error("Persistent goals for remote members are not supported by this bridge. Start the goal on the member's own machine."), { status: 409 });
      if (remote) {
        await proxyChatStream(remote, payload, res);
        return true;
      }
      if (pursuingGoal) { await streamGoal(payload, res); return true; }
      const outcome = await streamChat(payload, res);
      emitBridgeEvent("chat.finished", {
        memberId: String(payload.agentId || ""),
        status: outcome?.status || "completed",
        channelId: String(payload.channelId || payload.channel?.id || ""),
        threadId: String(payload.threadId || payload.channel?.threadId || ""),
        preview: String(outcome?.preview || ""),
      });
    } catch (error) {
      if (error.reason === "break") {
        const stream = startEventStream(res);
        stream.send("done", { reply: error.reply, declined: true, reason: "break", agentId: error.memberId });
        stream.end();
        return true;
      }
      emitBridgeEvent("chat.finished", { memberId: "", status: "failed", preview: String(error?.message || "").slice(0, 140) });
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && req.method === "GET") {
    if (await proxyRemoteRunRoute(req, res, url, runMatch[1])) return true;
    const run = runs.get(runMatch[1]);
    if (!run) {
      json(res, 404, { success: false, error: "run not found" });
      return true;
    }
    json(res, 200, { success: true, data: runSummary(run) });
    return true;
  }

  // Stop one run by id. A run this bridge forwarded is stopped on the bridge
  // that runs it; a local run is stopped the same way service shutdown does.
  const runStopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
  if (runStopMatch && req.method === "POST") {
    if (await proxyRemoteRunRoute(req, res, url, runStopMatch[1])) return true;
    const run = runs.get(runStopMatch[1]);
    if (!run) {
      json(res, 404, { success: false, error: "run not found" });
      return true;
    }
    const stopped = isLiveRun(run) ? await stopRun(run, "stopped by user") : false;
    json(res, 200, { success: true, data: { ...runSummary(run), stopped } });
    return true;
  }

  // Goal 08: preview a context pack before launch without starting a run.
  if (url.pathname === "/api/context-pack" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const mode = payload.mode || "prompt";
      const workspace = await cleanWorkspace(payload.workspace);
      const agentRuntime = await ensureAgentRuntime(payload, workspace);
      const pack = generateContextPack(mode, payload, agentRuntime, workspace);
      json(res, 200, { success: true, data: pack });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/runs" && req.method === "POST") {
    try {
      const payload = withRemoteDefaultWorkspace(req, await readBody(req));
      await memberAvailability.assertCanWork(payload);
      const remote = await resolveRemote(routeContext(), payload.agentId, { req });
      if (remote) {
        await proxyRunStart(remote, payload, res);
        return true;
      }
      json(res, 201, { success: true, data: await startRun(payload) });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message, ...(error.reason === "break" ? { reply: error.reply, declined: true, reason: "break" } : {}) });
    }
    return true;
  }

  // `!command` from the composer: run one shell command in the member's
  // workspace and return its output. Bounded by time and size; the workspace
  // must pass the same folder rules as every launch.
  if (url.pathname === "/api/shell" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const workspace = await cleanWorkspace(payload.workspace);
      const command = String(payload.command || "").trim().slice(0, 2000);
      if (!command) throw new Error("command is required");
      const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 60000, 1000), 300000);
      const startedAt = Date.now();
      const shell = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", command]] : ["/bin/bash", ["-lc", command]];
      const result = spawnSync(shell[0], shell[1], {
        cwd: workspace,
        env: { ...process.env, AUTOHAND_SQUAD_SHELL: "1" },
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      const cap = (text) => {
        const value = stripAnsi(text || "");
        return value.length > 64 * 1024 ? `${value.slice(0, 64 * 1024)}\n… (truncated)` : value;
      };
      logEvent(result.status === 0 ? SEVERITY.INFO : SEVERITY.WARN, `shell: ${command.slice(0, 120)}`, {
        "event.name": "composer.shell",
        "autohand.workspace": workspace,
        "process.exit_code": result.status ?? -1,
      });
      // The composer sends memberId when it knows which member's chat ran the
      // command; the audit trail records the shell.ran event under that member.
      emitBridgeEvent("shell.ran", {
        memberId: String(payload.memberId || payload.agentId || "").trim(),
        command,
        exitCode: result.status ?? -1,
        workspace,
      });
      json(res, 200, {
        success: true,
        data: {
          command,
          workspace,
          exitCode: result.status,
          signal: result.signal || "",
          timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT"),
          stdout: cap(result.stdout),
          stderr: cap(result.stderr),
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  // Native OS folder chooser for "which folder should this member work in".
  // The dialog runs on the machine that hosts the bridge; the chosen folder
  // still has to pass the same rules as every other workspace.
  // Folder profile for onboarding and squad recruiting (ADR-0015). Cached
  // per path for a minute; the signature lets clients dedupe proposals.
  if (url.pathname === "/api/workspaces/profile" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const workspace = await cleanWorkspace(String(payload.path || "").replace(/\/+$/, ""));
      const cached = workspaceProfileCache.get(workspace);
      if (cached && Date.now() - cached.at < 60000) {
        json(res, 200, { success: true, data: cached.profile });
        return true;
      }
      const profile = await profileWorkspace(workspace);
      workspaceProfileCache.set(workspace, { at: Date.now(), profile });
      json(res, 200, { success: true, data: profile });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  // Start tracking a folder with git. Onboarding offers this when the folder
  // someone picked is not a repository, so work a member does there is
  // recoverable from the first commit rather than the first regret.
  if (url.pathname === "/api/workspaces/track" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const workspace = await cleanWorkspace(String(payload.path || "").replace(/\/+$/, ""));
      const git = startTracking(workspace);
      // The profile is cached for a minute and has just become wrong.
      workspaceProfileCache.delete(workspace);
      json(res, 200, { success: true, data: { path: workspace, git } });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/workspaces/pick" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const title = String(payload.title || "Choose a folder for this member").slice(0, 120).replace(/["\\]/g, "");
      const start = String(payload.start || homeDir);
      let picked = "";
      if (process.platform === "darwin") {
        const script = `POSIX path of (choose folder with prompt "${title}" default location POSIX file "${start.replace(/"/g, "")}")`;
        const result = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 300000 });
        if (result.status !== 0) {
          if (/User cancel(l)?ed/i.test(result.stderr || "")) throw Object.assign(new Error("cancelled"), { status: 409 });
          throw new Error((result.stderr || "folder dialog failed").trim());
        }
        picked = String(result.stdout || "").trim();
      } else if (process.platform === "win32") {
        const script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = "${title}"; $d.SelectedPath = "${start.replace(/"/g, "")}"; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }`;
        const result = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8", timeout: 300000, windowsHide: true });
        picked = String(result.stdout || "").trim();
        if (!picked) throw Object.assign(new Error("cancelled"), { status: 409 });
      } else {
        const result = spawnSync("zenity", ["--file-selection", "--directory", `--title=${title}`, `--filename=${start.replace(/\/?$/, "/")}`], { encoding: "utf8", timeout: 300000 });
        picked = String(result.stdout || "").trim();
        if (!picked) throw Object.assign(new Error(result.status === 1 ? "cancelled" : "zenity is required for the folder dialog on Linux"), { status: result.status === 1 ? 409 : 400 });
      }
      const workspace = await cleanWorkspace(picked.replace(/\/+$/, ""));
      json(res, 200, { success: true, data: { path: workspace, name: basename(workspace) } });
    } catch (error) {
      json(res, error.status || 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/app-info" && req.method === "GET") {
    const data = await readAppInfo({ rootDir });
    json(res, 200, { success: true, data });
    return true;
  }
  if (url.pathname === "/api/product-telemetry" && req.method === "POST") {
    const payload = await readBody(req, 4096);
    void productTelemetry.capture(payload, { dnt: req.headers.dnt === "1" || req.headers["sec-gpc"] === "1" });
    json(res, 200, { success: true, data: { accepted: true, configured: productTelemetry.enabled } });
    return true;
  }

  // Fresh repository checks and verified installer downloads stay on the
  // local bridge; the client cannot supply a URL, path or command.
  if (url.pathname === "/api/updates" && req.method === "GET") {
    // Settings → System "Check for updates automatically" (ADR-0091) gates
    // unattended checks only; refresh=1 is the person asking and always runs.
    const data = await desktopUpdateStatus({
      squadStateDir,
      appVersion: packageMetadata.version || "",
      refresh: url.searchParams.get("refresh") === "1",
      autoCheck: autoCheckUpdatesEnabled(await readSystemSettings(squadStateDir)),
    });
    json(res, 200, { success: true, data });
    return true;
  }

  if (url.pathname === "/api/updates/progress" && req.method === "GET") {
    const data = await desktopUpdates.progress();
    if (data.phase === "failed" && !desktopUpdates.installing()) { desktopInstallLocked = false; await releaseDesktopDaemonAdmission(); }
    json(res, 200, { success: true, data });
    return true;
  }
  if (url.pathname === "/api/updates/upgrade" && req.method === "POST") {
    json(res, 202, { success: true, data: await desktopUpdates.start() });
    return true;
  }
  if (url.pathname === "/api/updates/cancel" && req.method === "POST") {
    json(res, 200, { success: true, data: await desktopUpdates.cancel() });
    return true;
  }
  if (url.pathname === "/api/updates/install" && req.method === "POST") {
    try {
      const input = await readBody(req, 1024);
      const data = await desktopUpdates.install({ preferInstaller: input?.mode === "installer" });
      if (data.installMode !== "restart") { desktopInstallLocked = false; await releaseDesktopDaemonAdmission(); }
      json(res, 200, { success: true, data });
    } catch (error) { if (!desktopUpdates.installing()) { desktopInstallLocked = false; await releaseDesktopDaemonAdmission(); } throw error; }
    return true;
  }

  if (url.pathname === "/api/updates/releases" && req.method === "POST") {
    await openDesktopTarget(RELEASES_URL);
    json(res, 200, { success: true, data: { opened: true, url: RELEASES_URL } });
    return true;
  }

  if (url.pathname === "/api/skills/catalog" && req.method === "GET") {
    try {
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      // What the person already has comes first, and a missing catalog no
      // longer empties the list: local skills are the ones that always work.
      const localRoots = localSkillRoots({ homeDir, squadStateDir, workspace: String(url.searchParams.get("workspace") || "") });
      const local = (await listLocalSkills(localRoots).catch(() => [])).map((skill) => ({
        id: skill.id,
        name: skill.name,
        category: skill.category,
        author: "",
        description: skill.description,
        local: true,
      }));
      const catalog = await loadSkillCatalog().catch(() => ({ skills: [] }));
      const seen = new Set(local.map((skill) => skill.id));
      const remote = (catalog?.skills || [])
        .filter((skill) => !seen.has(skill.id))
        .map((skill) => ({ id: skill.id, name: skill.name || skill.id, category: skill.category || "", author: skill.author || "", local: false }));
      const matches = (skill) => !query || `${skill.id} ${skill.name || ""} ${skill.category || ""} ${skill.description || ""}`.toLowerCase().includes(query);
      const skills = [...local, ...remote].filter(matches).slice(0, 40);
      json(res, 200, { success: true, data: { skills } });
    } catch (error) {
      json(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/terminal" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await openTerminal(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  return false;
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

async function serveStatic(req, res, url) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    json(res, 400, { success: false, error: "malformed path" });
    return;
  }
  const requestedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const relativePath = requestedPath.replace(/^[/\\]+/, "");
  let filePath = join(distDir, relativePath === "" ? "index.html" : relativePath);
  if (!filePath.startsWith(distDir)) {
    json(res, 403, { success: false, error: "forbidden" });
    return;
  }
  try {
    let fileStat = existsSync(filePath) ? await stat(filePath) : null;
    if (!fileStat || !fileStat.isFile()) {
      // Directories and unknown paths fall back to the SPA shell; a missing
      // built asset must not masquerade as HTML.
      if (relativePath.startsWith("assets/")) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      filePath = join(distDir, "index.html");
      fileStat = await stat(filePath);
    }
    res.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "content-length": fileStat.size,
    });
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

async function stopAndExitFromSignal(signal) {
  await stopManagedRuns(`web server received ${signal}`);
  process.exit(0);
}

process.once("SIGTERM", () => {
  stopAndExitFromSignal("SIGTERM").catch(() => process.exit(1));
});
process.once("SIGINT", () => {
  stopAndExitFromSignal("SIGINT").catch(() => process.exit(1));
});

if (isPackagedRuntime) {
  await mkdir(appStateDir, { recursive: true });
}

server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || "/", `http://${host}:${port}`);
  } catch {
    json(res, 400, { success: false, error: "invalid request url" });
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    // Another machine's bridge presenting a token this one minted: the
    // same-origin check does not apply (there is no browser Origin), only
    // the member-serving routes are reachable, and the token's label goes
    // to the log so the audit trail shows which machine asked.
    let auth = { remote: false, allowed: false, token: null };
    try {
      auth = await remoteRequestAuth(routeContext(), req);
    } catch (error) {
      logEvent(SEVERITY.WARN, `remote token check failed: ${error?.message || error}`, { "url.path": url.pathname });
      auth = { remote: true, allowed: false, token: null };
    }
    if (auth.remote && !auth.allowed) {
      logEvent(SEVERITY.WARN, `rejected remote request without a valid bearer token: ${req.method} ${url.pathname}`, {
        "event.name": "remote.rejected",
        "http.request.method": req.method,
        "url.path": url.pathname,
        "http.response.status_code": 401,
      });
      json(res, 401, { success: false, error: "bearer token required" });
      return;
    }
    if (auth.remote) {
      if (!remoteServedPath(url.pathname)) {
        json(res, 404, { success: false, error: `no remote route for ${req.method} ${url.pathname}` });
        return;
      }
      logEvent(SEVERITY.INFO, `remote request from ${auth.token?.label || "shared machine"}: ${req.method} ${url.pathname}`, {
        "event.name": "remote.served",
        "http.request.method": req.method,
        "url.path": url.pathname,
        "autohand.remote.token.id": auth.token?.id || "",
        "autohand.remote.token.label": auth.token?.label || "",
      });
    } else if (!requestOriginAllowed(req, url)) {
      json(res, 403, { success: false, error: "cross-origin requests to the local bridge are not allowed" });
      return;
    }
    if (desktopInstallLocked && !["GET", "HEAD"].includes(req.method) && !url.pathname.startsWith("/api/updates/")) {
      json(res, 503, { success: false, error: "Squad is installing an update. Wait for it to reopen." });
      return;
    }
    try {
      if (await handleApi(req, res, url)) return;
    } catch (error) {
      logEvent(SEVERITY.ERROR, `API request failed: ${error?.message || error}`, {
        "http.request.method": req.method,
        "url.path": url.pathname,
        "http.response.status_code": error?.status || 500,
        "error.type": error?.name || "Error",
      });
      if (!res.headersSent) json(res, error?.status || 500, { success: false, error: error?.message || "internal error" });
      return;
    }
    json(res, 404, { success: false, error: `no route for ${req.method} ${url.pathname}` });
    return;
  }
  if (vite) {
    vite.middlewares(req, res, () => {
      readFile(join(rootDir, "index.html"), "utf8")
        .then((template) => vite.transformIndexHtml(url.pathname, template))
        .then((html) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html);
        })
        .catch((error) => {
          vite.ssrFixStacktrace(error);
          res.writeHead(500);
          res.end(error.stack);
        });
    });
    return;
  }
  await serveStatic(req, res, url);
});

await runHistory.restore().catch((error) => console.error(`run history could not be restored: ${error?.message || error}`));

server.listen(port, host, () => {
  console.log(`autohandSWE listening on http://${host}:${port}`);
  loadRoutePlugins(routeContext(), { log: console.log }).catch((error) => console.error(`route plug-ins failed: ${error?.message || error}`));
  projectObserver.start().catch(error => console.error(`project observer could not start: ${error.message}`));
  logEvent(SEVERITY.INFO, `bridge listening on http://${host}:${port}`, {
    "server.address": host,
    "server.port": port,
    "autohand.cli.version": getRuntime().version,
    "autohand.cli.source": getRuntime().autohandSource,
    "autohand.otel.export": otel.exportEnabled,
  });
});
