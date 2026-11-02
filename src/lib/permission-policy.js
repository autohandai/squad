// The tool permission policy: which built-in tools a squad member may use,
// and what each rung of the autonomy ladder grants.
//
// This lives in src/lib rather than the App monolith so it can be run from
// Node and tested. It was not, and two faults shipped unnoticed: every tool
// started blocked and the skills group was never granted, so `skill` was
// blocked at every rung and no member could use a skill it had. The guard for
// that had to read the source with a regular expression, which is a test of
// the text rather than the behaviour.
//
// Pure: no React, no DOM, no icons. The ladder's presentation, its labels and
// its icons stay in the app; only the policy is here.
//
// See docs/adrs/ADR-0042-permission-policy-module.md.

export const BUILT_IN_TOOL_POLICY_GROUPS = [
  {
    id: "goals-planning",
    title: "Goals & Planning",
    tools: [
      ["tools_registry", "allow"],
      ["tool_search", "allow"],
      // The CLI's follow-up question never reaches a Squad window: with --yes
      // it answers itself "Yes", and without it RPC mode waits on a terminal
      // modal nobody sees (ADR-0161). A member asks in its reply instead.
      ["ask_followup_question", "block"],
      ["todo_write", "allow"],
      ["plan", "allow"],
      ["exit_plan_mode", "allow"],
      ["get_goal", "allow"],
      ["create_goal", "ask"],
      ["create_goal_from_template", "ask"],
      ["update_goal", "ask"],
      ["clear_goal", "ask"],
      ["list_goal_templates", "allow"],
      ["enqueue_goal", "ask"],
      ["list_goal_queue", "allow"],
      ["start_queued_goal", "ask"],
      ["dequeue_goal", "ask"],
      ["remove_queued_goal", "ask"],
    ],
  },
  {
    id: "profile-memory",
    title: "Memory, Skills & Teams",
    tools: [
      ["skill", "allow"],
      ["find_agent_skills", "allow"],
      ["install_agent_skill", "ask"],
      ["save_memory", "ask"],
      ["recall_memory", "allow"],
      ["smart_context_cropper", "allow"],
      ["create_meta_tool", "ask"],
      ["delegate_task", "ask"],
      ["delegate_parallel", "ask"],
      // Autohand Code's own teams are processes inside one CLI session, not
      // Squad members a person can see or talk to. Chief of Staff offered
      // them when asked to build a team and nothing appeared in Squad
      // (ADR-0161); the Squad team tools below are the route that works.
      ["create_team", "block"],
      ["add_teammate", "block"],
      ["team_status", "block"],
      ["send_team_message", "block"],
    ],
  },
  {
    // Squad's own team, reached through the managed autohand-squad MCP
    // server (ADR-0134). The engine sees these as mcp__autohand-squad__<tool>;
    // `managedToolPolicies` writes those names, so this is the one place a
    // person decides whether a member may message teammates or propose a
    // team. create_channel and schedule keep their Squad-side decision
    // (proposal or direct) and are always reachable at the MCP layer.
    id: "squad-team",
    title: "Squad team tools",
    tools: [
      ["squad_team", "allow"],
      ["squad_message", "allow"],
      ["squad_replies", "allow"],
      ["squad_teach", "allow"],
      ["squad_remember", "allow"],
      ["squad_recall", "allow"],
      ["squad_forget", "allow"],
      ["squad_set_profile", "allow"],
      ["squad_get_profile", "allow"],
      ["squad_update_memory", "allow"],
      ["squad_schedule", "allow"],
      ["squad_create_channel", "ask"],
      ["squad_channels", "allow"],
      ["squad_channel_messages", "allow"],
      ["squad_post_channel", "allow"],
      ["squad_work_plan", "allow"],
      ["squad_task", "allow"],
      ["squad_models", "allow"],
      ["squad_set_fallbacks", "allow"],
      ["squad_search_memory", "allow"],
      ["squad_memory_graph", "allow"],
      ["squad_read_memory", "allow"],
      ["squad_share_memory", "allow"],
      ["squad_relate_memories", "allow"],
      ["squad_organize_memory", "allow"],
      ["squad_propose_team", "allow"],
    ],
  },
  {
    id: "shell",
    title: "Shell",
    tools: [
      ["shell", "ask"],
      ["run_command", "ask"],
      ["custom_command", "ask"],
    ],
  },
  {
    id: "filesystem-read",
    title: "Filesystem Read & Inspect",
    tools: [
      ["read_file", "allow"],
      ["fff_find", "allow"],
      ["fff_grep", "allow"],
      ["list_tree", "allow"],
      ["file_stats", "allow"],
      ["checksum", "ask"],
    ],
  },
  {
    id: "filesystem-write",
    title: "Filesystem Write & Mutate",
    tools: [
      ["write_file", "ask"],
      ["append_file", "ask"],
      ["apply_patch", "ask"],
      ["search_replace", "ask"],
      ["notebook_edit", "ask"],
      ["format_file", "ask"],
      ["create_directory", "ask"],
      ["rename_path", "ask"],
      ["copy_path", "ask"],
      ["delete_path", "block"],
      ["add_dependency", "ask"],
      ["remove_dependency", "ask"],
    ],
  },
  {
    id: "git-read",
    title: "Git Read",
    tools: [
      ["git_status", "allow"],
      ["git_list_untracked", "allow"],
      ["git_diff", "allow"],
      ["git_diff_range", "allow"],
      ["git_log", "allow"],
      ["git_branch", "allow"],
      ["git_worktree_list", "allow"],
      ["git_worktree_status_all", "allow"],
      ["git_stash_list", "allow"],
    ],
  },
  {
    id: "git-write",
    title: "Git Write",
    tools: [
      ["git_add", "ask"],
      ["git_commit", "ask"],
      ["auto_commit", "ask"],
      ["git_push", "ask"],
      ["git_fetch", "ask"],
      ["git_pull", "ask"],
      ["git_checkout", "ask"],
      ["git_switch", "ask"],
      ["git_merge", "ask"],
      ["git_merge_abort", "ask"],
      ["git_apply_patch", "ask"],
      ["git_stash", "ask"],
      ["git_stash_pop", "ask"],
      ["git_stash_apply", "ask"],
      ["git_stash_drop", "ask"],
      ["git_cherry_pick", "ask"],
      ["git_cherry_pick_abort", "ask"],
      ["git_cherry_pick_continue", "ask"],
      ["git_rebase", "ask"],
      ["git_rebase_abort", "ask"],
      ["git_rebase_continue", "ask"],
      ["git_rebase_skip", "ask"],
      ["git_reset", "block"],
      ["git_worktree_add", "ask"],
      ["git_worktree_remove", "ask"],
      ["git_worktree_cleanup", "ask"],
      ["git_worktree_run_parallel", "ask"],
      ["git_worktree_sync", "ask"],
      ["git_worktree_create_for_pr", "ask"],
      ["git_worktree_create_from_template", "ask"],
    ],
  },
  {
    id: "web-browser",
    title: "Web & Browser",
    tools: [
      ["web_search", "ask"],
      ["fetch_url", "ask"],
      ["web_repo", "ask"],
      ["package_info", "allow"],
      ["browser_screenshot", "allow"],
      ["browser_navigate", "allow"],
      ["browser_get_page_context", "allow"],
      ["browser_get_element", "allow"],
      ["browser_find_element", "allow"],
      ["browser_wait_for_element", "allow"],
      ["browser_get_tabs", "allow"],
      ["browser_get_tab_groups", "allow"],
      ["browser_read_network", "allow"],
      ["browser_read_console", "allow"],
      ["browser_click", "ask"],
      ["browser_type", "ask"],
      ["browser_scroll", "ask"],
      ["browser_press_key", "ask"],
      ["browser_execute_js", "ask"],
    ],
  },
  {
    id: "tasks-automation",
    title: "Tasks & Automation",
    tools: [
      ["create_task", "ask"],
      ["task_get", "allow"],
      ["task_list", "allow"],
      ["task_update", "ask"],
      ["task_stop", "ask"],
      ["task_output", "allow"],
      ["sleep", "allow"],
      ["cron_create", "ask"],
      ["cron_delete", "ask"],
      ["list_schedules", "allow"],
      ["cancel_schedule", "ask"],
    ],
  },
  {
    id: "workspace-meta",
    title: "Workspace & Review",
    tools: [
      ["enter_worktree", "ask"],
      ["exit_worktree", "allow"],
      ["project_tracker", "allow"],
      ["request_directory_access", "ask"],
      ["code_review", "allow"],
    ],
  },
  {
    // The person's vault (ADR-0104). Listing shows hints only; the two
    // request tools always end in a human decision, so "ask" is their nature;
    // filling needs a member workstation and refuses on the host.
    id: "vault",
    title: "Vault & Payments",
    tools: [
      ["vault_list", "allow"],
      ["request_secret", "ask"],
      ["request_payment_approval", "ask"],
      ["vault_fill", "ask"],
    ],
  },
];

export const VAULT_TOOLS = ["vault_list", "request_secret", "request_payment_approval", "vault_fill"];

/**
 * Whether a member's permissions let the bridge hand it the vault MCP server
 * at all. Blocked means not even `vault_list`; the server is then not
 * injected, so the tools do not exist for that member rather than failing.
 */
export function vaultToolsAllowed(permissions) {
  const source = permissions && typeof permissions === "object" ? permissions : {};
  if (source.builtInToolPolicyEnabled === false) return true;
  const policies = source.builtInPolicies && typeof source.builtInPolicies === "object" ? source.builtInPolicies : {};
  return VAULT_TOOLS.some((tool) => (policies[tool] ?? DEFAULT_BUILT_IN_TOOL_POLICIES[tool]) !== "block");
}

export const DEFAULT_BUILT_IN_TOOL_POLICIES = Object.fromEntries(
  BUILT_IN_TOOL_POLICY_GROUPS.flatMap((group) => group.tools.map(([name, mode]) => [name, mode]))
);

export const MERGE_BLOCKED_TOOLS = new Set([
  "git_merge",
  "git_merge_abort",
  "git_rebase",
  "git_rebase_abort",
  "git_rebase_continue",
  "git_rebase_skip",
  "git_reset",
]);

/**
 * Every tool's mode at a given rung of the ladder.
 *
 * Takes the rank rather than the level id, so this module needs nothing from
 * the ladder's presentation. Ranks start at 1.
 */
export function builtInPoliciesForRank(rank) {
  const policies = Object.fromEntries(Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES).map((tool) => [tool, "block"]));
  const setTools = (tools, mode) => {
    for (const tool of tools) {
      if (Object.prototype.hasOwnProperty.call(policies, tool)) {
        policies[tool] = mode;
      }
    }
  };
  const setGroup = (groupId, mode) => {
    const group = BUILT_IN_TOOL_POLICY_GROUPS.find((item) => item.id === groupId);
    setTools((group?.tools || []).map(([tool]) => tool), mode);
  };
  // Each tool in a group already declares the mode it was designed for, most
  // of them "ask". Applying those rather than one blanket mode keeps the
  // grant as narrow as the group's own author intended.
  const applyGroupDefaults = (groupId) => {
    const group = BUILT_IN_TOOL_POLICY_GROUPS.find((item) => item.id === groupId);
    for (const [tool, mode] of group?.tools || []) setTools([tool], mode);
  };

  setTools(
    [
      "tools_registry",
      "tool_search",
      "plan",
      "list_goal_templates",
      "recall_memory",
      "smart_context_cropper",
      // Using a skill the member is already configured with, and looking up
      // which skills exist, are reads of its own profile rather than actions
      // on the world. These were blocked at every level of the ladder, so a
      // member could never use any skill it had; the whole feature was off.
      "skill",
      "find_agent_skills",
    ],
    "allow"
  );
  setTools(
    [
      "create_goal",
      "create_goal_from_template",
      "update_goal",
      "clear_goal",
      "enqueue_goal",
      "dequeue_goal",
      "remove_queued_goal",
      "save_memory",
      "delegate_task",
      "delegate_parallel",
      "create_meta_tool",
    ],
    "ask"
  );
  // Squad's own team is reachable at every rung: the lowest rung is a
  // conversation, and talking to a teammate or proposing a team is part of
  // one. Channel creation keeps its Squad-side approval (ADR-0161).
  applyGroupDefaults("squad-team");

  if (rank >= 1) {
    // Installing a skill, writing memory or starting a teammate are changes,
    // so they arrive at the mode their group declares, which for all of them
    // is "ask". The person is prompted rather than refused.
    applyGroupDefaults("profile-memory");
  }

  if (rank >= 3) {
    setGroup("filesystem-read", "allow");
    setGroup("git-read", "allow");
    // The vault arrives with the rung that lets a member act in the world:
    // the lowest rungs are a conversation and get no vault tools.
    applyGroupDefaults("vault");
    setTools(
      [
        "package_info",
        "browser_screenshot",
        "browser_navigate",
        "browser_get_page_context",
        "browser_get_element",
        "browser_find_element",
        "browser_wait_for_element",
        "browser_read_network",
        "browser_read_console",
        "task_get",
        "task_list",
        "sleep",
        "list_schedules",
        "project_tracker",
        "code_review",
      ],
      "allow"
    );
    setTools(
      [
        "shell",
        "run_command",
        "custom_command",
        "web_search",
        "fetch_url",
        "web_repo",
        "browser_click",
        "browser_type",
        "browser_scroll",
        "browser_press_key",
        "browser_execute_js",
        "request_directory_access",
      ],
      "ask"
    );
  }

  if (rank >= 4) {
    setGroup("filesystem-write", "ask");
    setGroup("tasks-automation", "ask");
    setTools(["apply_patch", "format_file", "search_replace", "create_directory"], "allow");
    setTools(["delete_path", "remove_dependency"], "block");
  }

  if (rank >= 5) {
    setGroup("git-write", "ask");
    setGroup("workspace-meta", "ask");
    setTools(["exit_worktree", "project_tracker", "code_review"], "allow");
    setTools(["git_push", "git_worktree_create_for_pr", "git_worktree_create_from_template"], "ask");
  }

  setTools([...MERGE_BLOCKED_TOOLS], "block");
  setTools(["delete_path", "git_reset"], "block");
  setTools([...SQUAD_UNREACHABLE_TOOLS], "block");
  return policies;
}

// --- tools the engine reaches through Squad's managed MCP servers -------------
//
// Autohand Code names an MCP tool `mcp__<server>__<tool>` and matches
// permission patterns on that exact kind. Squad used to write only the
// built-in kinds above into `availableTools`, which the CLI treats as a strict
// allowlist checked before the permission mode, so every Squad team tool, the
// vault and Computer Use were denied with `not_in_available` whatever the
// person chose in the UI (ADR-0161). The rows people see keep the bare names;
// this maps them to the kinds the engine checks.

export const SQUAD_TEAM_MCP_SERVER = "autohand-squad";
export const VAULT_MCP_SERVER = "autohand-vault";
export const COMPUTER_USE_MCP_SERVER = "autohand-computer-use";

/** Tools that cannot work for a Squad member on any rung, so every rung blocks them. */
export const SQUAD_UNREACHABLE_TOOLS = Object.freeze([
  // Answered "Yes" by --yes or stuck on a terminal modal; never shown in Squad.
  "ask_followup_question",
  // Autohand Code's in-process teams are not Squad members (ADR-0161).
  "create_team",
  "add_teammate",
  "team_status",
  "send_team_message",
]);

export const SQUAD_TEAM_TOOLS = Object.freeze(
  BUILT_IN_TOOL_POLICY_GROUPS.find((group) => group.id === "squad-team").tools.map(([tool]) => tool)
);

// Squad decides these itself (proposal or direct creation, ADR-0110/0126); the
// MCP layer must let the call through so that decision can happen.
export const SQUAD_GATED_TOOLS = Object.freeze(["squad_create_channel", "squad_schedule"]);

// Computer Use tools the bridge proxies (server/computer-use.mjs). The proxy
// checks the member's observe/control grant on every call; the engine only
// has to be allowed to make the call.
export const COMPUTER_USE_TOOLS = Object.freeze([
  "list_apps", "list_windows", "get_window_state", "get_desktop_state", "get_screen_size", "get_cursor_position", "verify_state", "get_session_state", "start_recording", "stop_recording", "get_recording_state",
  "launch_app", "bring_to_front", "set_window_frame", "invoke_menu", "click", "double_click", "right_click", "drag", "type_text", "press_key", "hotkey", "set_value", "scroll", "move_cursor",
]);

export const WEB_RESEARCH_TOOLS = Object.freeze(["web_search", "web_fetch"]);

export function mcpToolKind(server, tool) {
  return `mcp__${server}__${tool}`;
}

/**
 * The engine-facing kinds and modes for Squad's managed MCP servers.
 *
 *   policies    the member's bare-name policy map (builtInPolicies)
 *   connectors  server names of enabled built-in web research connectors
 *
 * Returns [[kind, mode], ...]. A row the person set to block stays blocked;
 * gated Squad tools are allowed at this layer because Squad asks itself.
 */
export function managedToolPolicies(policies = {}, { connectors = [] } = {}) {
  const source = policies && typeof policies === "object" ? policies : {};
  const modeOf = (tool, fallback) => {
    const value = source[tool] ?? DEFAULT_BUILT_IN_TOOL_POLICIES[tool] ?? fallback;
    return ["allow", "ask", "block"].includes(value) ? value : fallback;
  };
  const rows = [];
  for (const tool of SQUAD_TEAM_TOOLS) {
    const mode = modeOf(tool, "allow");
    rows.push([mcpToolKind(SQUAD_TEAM_MCP_SERVER, tool), SQUAD_GATED_TOOLS.includes(tool) && mode !== "block" ? "allow" : mode]);
  }
  for (const tool of VAULT_TOOLS) rows.push([mcpToolKind(VAULT_MCP_SERVER, tool), modeOf(tool, "ask")]);
  for (const tool of COMPUTER_USE_TOOLS) rows.push([mcpToolKind(COMPUTER_USE_MCP_SERVER, tool), "allow"]);
  for (const server of connectors) {
    for (const tool of WEB_RESEARCH_TOOLS) rows.push([mcpToolKind(server, tool), "allow"]);
  }
  return rows;
}
