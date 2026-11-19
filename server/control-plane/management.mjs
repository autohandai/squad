import { INSTRUCTIONS_INPUT_LIMIT, INSTRUCTIONS_LIMIT, fitInstructions, isContinuation, memoriesWith, replaceContinuations } from './instruction-blocks.mjs';
import { randomUUID } from 'node:crypto';
import { CHANNEL_NOTIFICATION_MODES } from '../../src/lib/channel-notifications.js';
import { isGroupChat } from '../../src/lib/group-chats.js';
import { detectRecurringWork } from '../../src/lib/work-plans.js';

const text = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const id = () => text(200);
const ids = (minimum = 0) => ({ type: 'array', items: id(), minItems: minimum, maxItems: 20 });
const revision = { type: 'integer', minimum: 0 };
const mode = { type: 'string', enum: ['allow', 'ask', 'block'] };
const policies = { type: 'array', maxItems: 200, items: { type: 'object', properties: { id: id(), mode }, required: ['id', 'mode'], additionalProperties: false } };
const schedule = {
  type: 'object', additionalProperties: false, required: ['kind'],
  description: 'Omit timeZone to use this computer\'s zone, which is the person\'s.',
  properties: {
    kind: { type: 'string', enum: ['once', 'weekdays', 'interval', 'monthly', 'yearly', 'cron'] },
    timeZone: text(100), time: text(5), date: text(10),
    days: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } },
    everyMinutes: { type: 'integer', minimum: 1, maximum: 1440 }, startDate: text(10), startTime: text(5),
    month: { type: 'integer', minimum: 1, maximum: 12 },
    day: { anyOf: [{ type: 'integer', minimum: 1, maximum: 31 }, { type: 'string', enum: ['last'] }] },
    cron: text(120),
  },
};
const tool = (name, description, properties, required = [], readOnly = false) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: ['send_channel_message', 'run_routine'].includes(name) } });
const trigger = { type: 'string', enum: ['schedule', 'webhook'], description: 'schedule (default) runs on the clock; webhook runs when its secret URL on this computer\'s bridge receives a POST, with the JSON body passed to the member as data.' };
const when = { type: 'string', minLength: 1, maxLength: 300, description: 'The schedule in the person\'s words ("every weekday at 9am", "every day at 7:30pm", "every 2 hours", "every Monday morning", "end of every month"), read by Squad\'s own recurring-work reader. Use schedule instead for one-off dates or anything it cannot read.' };
const member = { member_id: id(), expected_revision: revision };
const routineFields = { title: text(160), instructions: text(20000), workspace: text(1000), trigger, schedule, when, enabled: { type: 'boolean' }, max_run_minutes: { type: 'integer', minimum: 1, maximum: 1440 } };
const profileFields = { name: text(60), role: text(80), description: { type: 'string', maxLength: 600 }, responsibilities: { type: 'string', maxLength: 600, description: 'Alias of the saved description. Do not send both.' }, instructions: { type: 'string', maxLength: INSTRUCTIONS_INPUT_LIMIT, description: `How the member works. Up to ${INSTRUCTIONS_LIMIT} characters are saved as its instructions; anything longer is kept, not refused: Squad cuts at a paragraph or sentence and saves the rest, in order, as profile memories of up to 500 characters labelled "Operating instructions, continued (n/m)", and the reply says so. Put the essentials first.` }, personality: { type: 'string', maxLength: 600 } };
const skillIds = { type: 'array', maxItems: 32, items: text(500) };
const memoryTexts = { type: 'array', maxItems: 100, items: text(500), description: 'Profile memories only; does not replace shared, project or conversation memory.' };

const feedbackFields = { summary: { type: 'string', minLength: 8, maxLength: 200, description: 'One sentence: what went wrong, or what to improve.' }, detail: { type: 'string', maxLength: 8000, description: 'What happened, what was expected, exact error text. No secrets.' }, reporter: { type: 'string', maxLength: 80, description: 'Who is reporting (the agent or client name).' }, include_diagnostics: { type: 'boolean' } };
export const MANAGEMENT_TOOLS = [
  tool('report_bug', 'Report a bug in Autohand Squad to Autohand when one blocks the work (a Squad tool erroring when it should not, a crash, wrong data). Sends the same sanitised report as Report a bug in the app, labelled as from an agent, with diagnostics and no screenshot; at most five an hour from this computer and never the same one twice in an hour. Tell the person you reported it.', feedbackFields, ['summary']),
  tool('give_feedback', 'Send Autohand feedback about Squad (something confusing, missing or slow). Same path and limits as report_bug. Tell the person you sent it.', feedbackFields, ['summary']),
  tool('create_member', 'Create a real saved Squad member in the selected owner. Limits: name 60, role 80, description 600, instructions 1200 (longer instructions are split into profile memories automatically), personality 600, each memory 500, at most 100 memories. Selects a ready default engine and saves up to four connected engine fallbacks with their default models and reasoning; an explicit engine is preserved. A stable request_id makes retries idempotent. Saves profile, catalog skill selections and initial profile memories without launching work, granting broad permissions or enabling routines. Workspace is optional; no folder is created implicitly.', { request_id: text(128), ...profileFields, skills: skillIds, memories: memoryTexts, workspace: text(1000), engine: text(200) }, ['request_id', 'name', 'role']),
  tool('get_member_profile', 'Read a member\'s saved name, personality, operating instructions, skills, folders and abilities, with its revision and available ability IDs. Operator access.', { member_id: id() }, ['member_id'], true),
  tool('get_member_computer_use', 'Read an existing member\'s saved Computer Use scope and OS readiness. Read-only; does not grant access or show OS prompts. Enabling requires explicit native confirmation in Squad.', { member_id: id() }, ['member_id'], true),
  tool('revoke_member_computer_use', 'Turn off Computer Use for an existing member. Revokes its current grant and stops verification recording; later work receives no Computer Use instructions or managed tools. Existing connected tools recheck the grant. Cannot enable access; leaves other members unchanged.', { member_id: id() }, ['member_id']),
  tool('update_member_profile', 'Change a saved member name, role, responsibilities, personality or operating instructions. Preserves other fields and current work. expected_revision rejects stale edits; changes apply to later turns.', { ...member, ...profileFields }, ['member_id']),
  tool('set_member_memories', 'Replace a member\'s profile memory texts with a revision-checked write (empty clears those texts). Preserves shared/project memory, conversation history and collected files.', { ...member, memories: memoryTexts }, ['member_id', 'memories']),
  tool('set_member_abilities', 'Set specific capability/tool policies to allow, ask or block. Get supported IDs from get_member_profile. Preserves unmentioned policies and workspace overrides. Optional workspace edits that folder\'s override. Does not grant OS permissions or disable safety guards.', { ...member, capabilities: policies, tool_policies: policies, workspace: text(1000) }, ['member_id']),
  tool('set_member_workspace', 'Replace a saved member primary workspace and complete additional-folder list for future turns. directories must be explicit (empty clears extras). Validates every existing folder before one revision-checked save. Does not create folders, initialize Git, delete files or restart current work. Managed members may only choose folders already assigned to both acting and target members.', { ...member, workspace: text(1000), directories: { type: 'array', maxItems: 49, items: text(1000) } }, ['member_id', 'workspace', 'directories']),
  tool('add_member_directory', 'Grant an existing project folder to a member, equivalent to --add-dir on later turns. Persists the folder on the member, validates its real path, and preserves other folders. Does not restart current work.', { ...member, path: text(1000) }, ['member_id', 'path']),
  tool('remove_member_directory', 'Remove an extra folder grant for later turns. Does not delete files or interrupt current work. The current primary workspace cannot be removed here.', { ...member, path: text(1000) }, ['member_id', 'path']),
  tool('list_skills', 'Discover local and registry skill packages available for a member\'s workspace. Choose package IDs for set_member_skills; offset supports catalog pagination.', { member_id: id(), query: { type: 'string', maxLength: 500 }, offset: { type: 'integer', minimum: 0, maximum: 100000 } }, ['member_id'], true),
  tool('set_member_skills', 'Replace a member\'s selected skill-package IDs (empty clears selections). Validates references against the catalog. Packages are installed/pinned by the existing engine preparation on the next turn; this receipt is assignment, not installation.', { ...member, skill_ids: { type: 'array', maxItems: 32, items: text(500) } }, ['member_id', 'skill_ids']),
  tool('get_channel', 'Read one channel\'s saved settings, member IDs and projects.', { channel_id: id() }, ['channel_id'], true),
  tool('update_channel', 'Change a channel name, purpose or section without replacing its members or history.', { channel_id: id(), name: text(80), purpose: { type: 'string', maxLength: 20000 }, section: { type: 'string', maxLength: 80 } }, ['channel_id']),
  tool('delete_channel', 'Delete a saved channel and its messages/threads from the selected Squad. Requires explicit confirm_delete:true. Members and their direct chats remain. Use delete_group_chat for a genuine group.', { channel_id: id(), confirm_delete: { type: 'boolean', enum: [true] } }, ['channel_id', 'confirm_delete']),
  tool('get_notification_preferences', 'Read the selected Squad operator\'s saved notification defaults, channel overrides and hidden states. Hiding is a presentation preference, not an access rule.', {}, [], true),
  tool('set_channel_notifications', 'Set the operator\'s local notification mode for one channel/group: all, mentions, muted, or default to inherit Settings. Optional hidden hides/shows its sidebar row. Does not stop work or change history/membership. Operator only.', { channel_id: id(), mode: { type: 'string', enum: [...CHANNEL_NOTIFICATION_MODES, 'default'] }, hidden: { type: 'boolean' } }, ['channel_id']),
  tool('set_notification_defaults', 'Choose the selected Squad operator\'s default channel/group notification mode. Preserves explicit channel choices and other alert settings. Operator only; never grants or revokes agent access.', { mode: { type: 'string', enum: CHANNEL_NOTIFICATION_MODES } }, ['mode']),
  tool('set_channel_members', 'Add/remove existing members atomically from a channel roster. Does not dispatch work or delete messages.', { channel_id: id(), add: ids(), remove: ids() }, ['channel_id']),
  tool('list_channel_threads', 'List a channel\'s newest conversation threads. Use get_messages with thread_id to read replies.', { channel_id: id(), limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['channel_id'], true),
  tool('list_group_chats', 'List saved private group chats, distinct from public/private channels. A managed member only sees groups it belongs to.', {}, [], true),
  tool('get_group_chat', 'Read one group chat and its member IDs. Use its ID as channel_id with the existing message/thread tools. A managed member must belong to it.', { group_id: id() }, ['group_id'], true),
  tool('create_group_chat', 'Create a persistent private group chat for two or more existing agents, distinct from a channel. Optional request_id makes creation retries safe. Does not send a message or start work.', { request_id: text(128), name: text(80), member_ids: ids(2) }, ['name', 'member_ids']),
  tool('convert_group_chat', 'Convert a group into an explicitly public or private channel. Retains its ID, members, messages and threads. Optional name renames it; request_id makes conversion replay safe without overwriting later edits.', { group_id: id(), visibility: { type: 'string', enum: ['public', 'private'] }, name: text(80), request_id: text(128) }, ['group_id', 'visibility']),
  tool('delete_group_chat', 'Delete a group chat and its messages/threads from this Squad. Refuses if it has already been converted to a channel. Existing member profiles and their direct conversations are preserved.', { group_id: id() }, ['group_id']),
  tool('send_channel_message', 'Post into a channel/group thread and optionally dispatch the explicitly named channel members. Omit member_ids to publish only. Replies persist in the thread even if this MCP client disconnects. Returns per-member run receipts/errors for wait_for_reply.', { channel_id: id(), thread_id: id(), text: text(20000), member_ids: ids() }, ['channel_id', 'text']),
  tool('list_routines', 'Read saved automations (routines): trigger, schedule in words, pause/enabled state, next occurrences, webhook URL and recent runs; optionally filter by member.', { member_id: id() }, [], true),
  tool('get_routine', 'Read one automation (routine), its webhook URL when it has one, and its run history.', { routine_id: id() }, ['routine_id'], true),
  tool('preview_routine', 'Check a schedule (explicit, or `when` in the person\'s words) and show it in words with its next three occurrences, without saving or running it. Omitted timeZone means this computer\'s.', { schedule, when }, [], true),
  tool('create_routine', 'Save an automation (routine) for an existing member. A request such as "remind me every day at 9am to stretch" or "every Monday, summarise open PRs" is a routine: pass `when` (or `schedule`), instructions written as what the member does each run, and enabled:true, because the person\'s direct request authorizes it. Without enabled:true it is saved paused. Times use this computer\'s timezone unless schedule.timeZone says otherwise. trigger "webhook" instead creates a secret URL that starts it; the receipt carries webhook.url. Uses the member workspace unless overridden. Never runs it immediately. Confirm back in plain words: what, when (the receipt\'s description and timezone) and the next run.', { member_id: id(), ...routineFields }, ['member_id', 'title', 'instructions']),
  tool('update_routine', 'Edit an automation, switch its trigger between schedule and webhook, or set enabled:false/true to pause/resume. Preserves unmentioned fields, member ownership, history and the webhook URL; does not stop an active run.', { routine_id: id(), ...routineFields }, ['routine_id']),
  tool('run_routine', 'Explicitly run a saved automation now using its saved member, workspace and permissions, through the same path as a scheduled or webhook start. Returns a run receipt; refuses overlap with an already active run.', { routine_id: id() }, ['routine_id']),
  tool('delete_routine', 'Delete a saved automation and its run history. Requires confirm_delete:true. Its webhook URL stops working; an active run is not stopped.', { routine_id: id(), confirm_delete: { type: 'boolean', enum: [true] } }, ['routine_id', 'confirm_delete']),
  tool('rotate_routine_webhook', 'Give a webhook automation a new secret URL. The previous URL stops working at once; services that call it need the new one from the receipt.', { routine_id: id() }, ['routine_id']),
  tool('revoke_routine_webhook', 'Turn off a webhook automation\'s URL without deleting the automation. Calls answer 404 until rotate_routine_webhook issues a new URL.', { routine_id: id() }, ['routine_id']),
];

export function createManagementTools(bridge, legacy) {
  const profile = memberId => bridge.get(`/api/control-plane/members/${encodeURIComponent(memberId)}`);
  async function patchMember(memberId, patch, expectedRevision) {
    const current = await profile(memberId);
    return bridge.patch(`/api/control-plane/members/${encodeURIComponent(memberId)}`, { ...patch, expectedRevision: expectedRevision ?? current.revision });
  }
  async function known(idsToCheck) {
    const roster = await legacy.list_members();
    for (const memberId of idsToCheck) if (!roster.members.some(item => item.id === memberId)) throw new Error(`Member ${memberId} was not found. Choose an ID from list_members.`);
  }
  async function channelFor(channelId) {
    const state = await bridge.get('/api/channels');
    const channel = (state.channels || []).find(item => item.id === channelId);
    if (!channel) throw Object.assign(new Error('Channel not found.'), { status: 404 });
    return { channel, state };
  }
  const routineBody = args => Object.fromEntries(Object.entries(withWhen(args)).filter(([key]) => !['member_id', 'routine_id', 'max_run_minutes', 'when'].includes(key)).concat(args.max_run_minutes !== undefined ? [['maxRunMinutes', args.max_run_minutes]] : []));

  const feedback = kind => ({ summary, detail, reporter, include_diagnostics }) => bridge.post('/api/feedback/agent', { kind, summary, detail, reporter: reporter || 'An MCP client', includeDiagnostics: include_diagnostics });
  return {
    report_bug: feedback('bug'),
    give_feedback: feedback('feedback'),
    async create_member(args) {
      if (args.instructions === undefined) return bridge.post('/api/control-plane/members', args);
      const fit = fitInstructions(args.instructions);
      const created = await bridge.post('/api/control-plane/members', { ...args, instructions: fit.instructions, ...(fit.blocks.length ? { memories: memoriesWith(fit.blocks, args.memories || []) } : {}) });
      return fit.split ? { ...created, instructionsSplit: fit.split } : created;
    },
    get_member_profile: ({ member_id }) => profile(member_id),
    async get_member_computer_use({ member_id }) {
      await profile(member_id);
      const result = await bridge.get(`/api/computer-use/status?${new URLSearchParams({ memberId: member_id })}`);
      return { ...result, member_id, enabled: ['observe', 'control'].includes(result.grant?.scope), requires_native_confirmation: true };
    },
    async revoke_member_computer_use({ member_id }) {
      await profile(member_id);
      const grant = await bridge.delete('/api/computer-use/grant', { memberId: member_id });
      return { member_id, enabled: false, grant, requires_native_confirmation: true };
    },
    async update_member_profile({ member_id, expected_revision, ...patch }) {
      if (patch.instructions === undefined) return patchMember(member_id, patch, expected_revision);
      const fit = fitInstructions(patch.instructions);
      const current = await profile(member_id);
      const hadBlocks = (current.memories || []).some(item => isContinuation(item?.text ?? item));
      const next = { ...patch, instructions: fit.instructions, ...(fit.blocks.length || hadBlocks ? { memories: replaceContinuations(current.memories || [], fit.blocks) } : {}) };
      const saved = await bridge.patch(`/api/control-plane/members/${encodeURIComponent(member_id)}`, { ...next, expectedRevision: expected_revision ?? current.revision });
      return fit.split ? { ...saved, instructionsSplit: fit.split } : saved;
    },
    set_member_abilities: ({ member_id, expected_revision, ...abilities }) => patchMember(member_id, { abilities }, expected_revision),
    async set_member_workspace({ member_id, workspace, directories, expected_revision }) {
      const current = await profile(member_id);
      return bridge.patch(`/api/control-plane/members/${encodeURIComponent(member_id)}/workspace`, { workspace, directories, expectedRevision: expected_revision ?? current.revision });
    },
    async add_member_directory({ member_id, path, expected_revision }) {
      const current = await profile(member_id);
      return bridge.post(`/api/control-plane/members/${encodeURIComponent(member_id)}/directories`, { operation: 'add', path, expectedRevision: expected_revision ?? current.revision });
    },
    async remove_member_directory({ member_id, path, expected_revision }) {
      const current = await profile(member_id);
      return bridge.post(`/api/control-plane/members/${encodeURIComponent(member_id)}/directories`, { operation: 'remove', path, expectedRevision: expected_revision ?? current.revision });
    },
    async list_skills({ member_id, query = '', offset = 0 }) {
      const current = await profile(member_id);
      return bridge.get(`/api/skills/catalog?${new URLSearchParams({ q: query, workspace: current.workspace || '', offset: String(offset) })}`);
    },
    set_member_skills: ({ member_id, expected_revision, skill_ids }) => patchMember(member_id, { skills: skill_ids }, expected_revision),
    set_member_memories: ({ member_id, expected_revision, memories }) => patchMember(member_id, { memories }, expected_revision),
    async get_channel({ channel_id }) { return (await channelFor(channel_id)).channel; },
    async update_channel({ channel_id, ...patch }) {
      if (!Object.keys(patch).length) throw new Error('Provide at least one channel setting to change.');
      return bridge.patch(`/api/channels/${encodeURIComponent(channel_id)}`, patch);
    },
    async delete_channel({ channel_id, confirm_delete }) {
      if (confirm_delete !== true) throw new Error('Confirm channel deletion with confirm_delete:true. This removes its saved messages and threads.');
      if (isGroupChat((await channelFor(channel_id)).channel)) throw new Error('This conversation is a group chat. Use delete_group_chat.');
      await bridge.delete(`/api/channels/${encodeURIComponent(channel_id)}`);
      return { id: channel_id, deleted: true };
    },
    get_notification_preferences: () => bridge.get('/api/notifications/settings'),
    async set_channel_notifications({ channel_id, ...patch }) {
      if (!Object.keys(patch).length) throw new Error('Choose a notification mode or hidden state.');
      return bridge.patch(`/api/notifications/channels/${encodeURIComponent(channel_id)}`, patch);
    },
    set_notification_defaults: ({ mode }) => bridge.put('/api/notifications/settings', { channelDefault: mode }),
    async set_channel_members({ channel_id, add = [], remove = [] }) {
      await channelFor(channel_id);
      if (!add.length && !remove.length) throw new Error('Choose members to add or remove.');
      if (add.some(id => remove.includes(id))) throw new Error('A member cannot be both added and removed.');
      await known(add);
      return bridge.post(`/api/channels/${encodeURIComponent(channel_id)}/members`, { add, remove });
    },
    async list_channel_threads({ channel_id, limit = 50 }) {
      await channelFor(channel_id);
      const threads = await bridge.get(`/api/channels/${encodeURIComponent(channel_id)}/threads`);
      return { threads: [...threads].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, limit) };
    },
    async create_group_chat({ name, member_ids, request_id }) {
      return { channel: await bridge.post('/api/group-chats', { name, memberIds: member_ids, ...(request_id ? { requestId: request_id } : {}) }) };
    },
    list_group_chats: () => bridge.get('/api/group-chats'),
    get_group_chat: ({ group_id }) => bridge.get(`/api/group-chats/${encodeURIComponent(group_id)}`),
    async convert_group_chat({ group_id, visibility, name, request_id }) {
      return { channel: await bridge.post(`/api/group-chats/${encodeURIComponent(group_id)}/convert`, { visibility, ...(name !== undefined ? { name } : {}), ...(request_id ? { requestId: request_id } : {}) }) };
    },
    delete_group_chat: ({ group_id }) => bridge.delete(`/api/group-chats/${encodeURIComponent(group_id)}`),
    async send_channel_message({ channel_id, thread_id, text, member_ids = [] }) {
      const { channel, state } = await channelFor(channel_id);
      const recipients = [...new Set(member_ids)];
      if (recipients.some(id => !channel.memberIds.includes(id))) throw new Error('Every recipient must belong to the channel. Add them with set_channel_members first.');
      await known(recipients);
      if (thread_id && !(state.threads || []).some(thread => thread.id === thread_id && thread.channelId === channel_id)) throw new Error('The thread does not belong to this channel.');
      const profiles = await Promise.all(recipients.map(id => profile(id)));
      if (profiles.some(item => !item.workspace)) throw new Error('Each recipient needs a saved workspace before dispatch.');
      const messageId = `operator-${randomUUID()}`;
      const threadId = thread_id || `thread-${randomUUID()}`;
      const at = new Date().toISOString();
      await bridge.put('/api/channels/sync', {
        ...(!thread_id ? { threads: [{ id: threadId, channelId: channel_id, parentMessageId: messageId, title: text.slice(0, 160), creatorId: 'person', memberIds: channel.memberIds, createdAt: at, updatedAt: at }] } : {}),
        messages: { [channel_id]: [{ id: messageId, role: 'user', body: text, authorName: 'You', threadId, status: 'complete', createdAt: at, updatedAt: at }] },
      });
      const deliveries = await Promise.all(recipients.map(async (memberId, index) => {
        try {
          const run = await bridge.post('/api/runs', { agentId: memberId, prompt: text, workspace: profiles[index].workspace, title: text.slice(0, 120), channel: { channelId: channel_id, channelName: channel.name, threadId, parentMessageId: messageId, operatorReply: true } });
          return { member_id: memberId, run_id: run.id, status: run.status };
        } catch (error) { return { member_id: memberId, status: 'failed', error: String(error.message || error) }; }
      }));
      return { channel_id, thread_id: threadId, message_id: messageId, deliveries, note: recipients.length ? 'Dispatched only the requested members. Check each run receipt; retrying this send creates a new message.' : 'Published without dispatching any member.' };
    },
    list_routines: ({ member_id } = {}) => bridge.get(`/api/routines${member_id ? `?memberId=${encodeURIComponent(member_id)}` : ''}`),
    get_routine: ({ routine_id }) => bridge.get(`/api/routines/${encodeURIComponent(routine_id)}`),
    preview_routine: (args = {}) => {
      const { schedule: resolved } = withWhen(args);
      if (!resolved) throw new Error('Provide schedule or when.');
      return bridge.post('/api/routines/preview', { schedule: resolved });
    },
    async create_routine({ member_id, ...args }) {
      if ((args.trigger || 'schedule') === 'schedule' && !args.schedule && !args.when) throw new Error('Provide schedule or when for a scheduled automation, or trigger:"webhook".');
      const current = await profile(member_id);
      return bridge.post('/api/routines', { ...routineBody(args), memberId: member_id, workspace: args.workspace || current.workspace, enabled: args.enabled === true });
    },
    async update_routine({ routine_id, ...args }) {
      if (!Object.keys(args).length) throw new Error('Provide at least one routine setting to change.');
      return bridge.patch(`/api/routines/${encodeURIComponent(routine_id)}`, routineBody(args));
    },
    run_routine: ({ routine_id }) => bridge.post(`/api/routines/${encodeURIComponent(routine_id)}/run`, {}),
    async delete_routine({ routine_id, confirm_delete }) {
      if (confirm_delete !== true) throw new Error('Confirm deletion with confirm_delete:true. This removes the automation and its run history.');
      await bridge.delete(`/api/routines/${encodeURIComponent(routine_id)}`);
      return { id: routine_id, deleted: true };
    },
    rotate_routine_webhook: ({ routine_id }) => bridge.post(`/api/routines/${encodeURIComponent(routine_id)}/webhook/rotate`, {}),
    revoke_routine_webhook: ({ routine_id }) => bridge.delete(`/api/routines/${encodeURIComponent(routine_id)}/webhook`),
  };
}

/**
 * `when` in the person's words becomes an explicit schedule through the same
 * reader the chat offer and the New automation draft fallback use
 * (detectRecurringWork, ADR-0125/0138); no second parser. An explicit
 * schedule wins. The timezone stays empty so the bridge applies this
 * computer's zone.
 */
export function withWhen(args = {}) {
  if (args.schedule || !args.when) return args;
  const found = detectRecurringWork(String(args.when));
  if (!found?.schedule) throw new Error(`Could not read a schedule from "${String(args.when).slice(0, 120)}". Send schedule explicitly, for example {"kind":"weekdays","days":[0,1,2,3,4,5,6],"time":"09:00"}.`);
  return { ...args, schedule: found.schedule };
}

export const MEMBER_MANAGEMENT_NAMES = Object.freeze(['create_member', 'get_member_profile', 'update_member_profile', 'set_member_workspace', 'list_skills', 'set_member_skills', 'set_member_memories', 'list_routines', 'create_routine', 'update_routine']);
export const GROUP_MANAGEMENT_NAMES = Object.freeze(['list_group_chats', 'get_group_chat', 'create_group_chat', 'convert_group_chat', 'delete_group_chat']);
export const MANAGED_MANAGEMENT_NAMES = Object.freeze([...MEMBER_MANAGEMENT_NAMES, ...GROUP_MANAGEMENT_NAMES]);
export const MANAGED_MANAGEMENT_TOOLS = MANAGEMENT_TOOLS.filter(tool => MANAGED_MANAGEMENT_NAMES.includes(tool.name)).map(tool => ({ ...tool, name: `squad_${tool.name}`, description: `${tool.description} Uses this member's saved management permission; ask mode needs the person's bounded confirmation in Squad.` }));
