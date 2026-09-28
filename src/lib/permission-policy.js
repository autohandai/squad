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
      ["ask_followup_question", "allow"],
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
      ["create_team", "ask"],
      ["add_teammate", "ask"],
      ["team_status", "allow"],
      ["send_team_message", "ask"],
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
];

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
      "ask_followup_question",
      "plan",
      "list_goal_templates",
      "recall_memory",
      "smart_context_cropper",
      "team_status",
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
      "create_team",
      "add_teammate",
      "send_team_message",
      "create_meta_tool",
    ],
    "ask"
  );

  if (rank >= 1) {
    // Installing a skill, writing memory or starting a teammate are changes,
    // so they arrive at the mode their group declares, which for all of them
    // is "ask". The person is prompted rather than refused.
    applyGroupDefaults("profile-memory");
  }

  if (rank >= 3) {
    setGroup("filesystem-read", "allow");
    setGroup("git-read", "allow");
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
  return policies;
}
