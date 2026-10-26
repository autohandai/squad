import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPersistentJson, writePersistentJson } from './persistent-json.mjs';
import { profileWorkspace } from './workspace-profile.mjs';
import { chiefOfStaffMember, GENERAL_CHANNEL_ID, recommendTeammates } from '../src/lib/first-run.js';

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

/** One installation owns the setup receipt, not a browser tab or a build. */
export function createOnboarding(ctx, { profile = profileWorkspace } = {}) {
  const file = join(ctx.squadStateDir, 'onboarding.json');
  let queue = Promise.resolve();
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  async function read() {
    const saved = await readPersistentJson(file, undefined).catch(() => { throw problem('Saved setup could not be read. Restore onboarding.json from your data folder before retrying; it has been kept.', 409); });
    if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== 1 || !['preparing', 'completed'].includes(saved.status) || !/^asq_[a-z0-9_-]+$/.test(saved.memberId) || !Array.isArray(saved.repositories) || !saved.repositories.length || saved.repositories.some(item => typeof item?.path !== 'string' || !item.path.trim()))) {
      throw problem('Saved setup could not be read. Restore onboarding.json from your data folder before retrying; it has been kept.', 409);
    }
    const channels = await ctx.readChannelsState();
    if (saved) return { ...saved, member: channels.agentChannelAccess[saved.memberId]?.removed ? null : channels.agentChannelAccess[saved.memberId]?.agent || null };
    // Updating an existing installation must not replace its team or settings.
    const snapshot = await ctx.readOptionalJsonFile(join(ctx.squadStateDir, 'web-status.json'));
    const existing = channels.channels.length || Object.keys(channels.agentChannelAccess).some(id => id !== 'squad-designer') || snapshot?.members?.some(member => member.id !== 'squad-designer');
    return { version: 1, status: existing ? 'existing' : 'new', repositories: [] };
  }
  async function analyze(paths) {
    const limit = ctx.getRuntime().limits?.maxProjectsPerMember || 50;
    if (!Array.isArray(paths) || !paths.length || paths.length > limit || paths.some(path => typeof path !== 'string' || !path.trim())) throw problem(`Choose between 1 and ${limit} repositories.`);
    const profiles = new Map();
    // Canonical git roots collapse subfolders and aliases; metadata is read
    // here again at completion, never trusted from a browser recommendation.
    for (const path of paths) {
      const folder = await ctx.cleanWorkspace(path).catch(error => { throw problem(error.message); });
      const inspected = await profile(folder);
      if (!inspected.git?.available) throw problem('Git is required to select a repository. Install Git and try again.');
      if (!inspected.git?.tracked || !inspected.git.root) throw problem(`${inspected.name} is not a Git repository. Choose a repository or start tracking this folder first.`);
      const root = await realpath(inspected.git.root);
      await ctx.cleanWorkspace(root).catch(error => { throw problem(error.message); });
      if (!profiles.has(root)) profiles.set(root, root === inspected.path ? inspected : await profile(root));
    }
    const repositories = [...profiles.values()];
    return { repositories, recommendations: recommendTeammates(repositories) };
  }
  const complete = paths => serialize(async () => {
    const saved = await read();
    // A retry after delivery failure, another window, or a restart returns
    // the receipt. Removed/renamed members and channels are never resurrected.
    if (saved.status === 'completed') return saved;
    if (saved.status === 'existing') throw problem('This installation already has a squad. Keep your team and add repositories from its member settings.', 409);
    const runtime = ctx.getRuntime();
    if (!runtime.account?.signedIn) throw problem('Sign in with your Autohand account before finishing setup.', 401);
    if (!runtime.available) throw problem('Prepare Autohand Code before finishing setup.', 409);
    const plan = await analyze(paths);
    const receipt = { version: 1, status: 'preparing', memberId: saved.memberId || `asq_${randomUUID().replaceAll('-', '')}`, repositories: plan.repositories, updatedAt: new Date().toISOString() };
    await writePersistentJson(file, receipt);
    const state = await ctx.readChannelsState();
    let member = state.agentChannelAccess[receipt.memberId]?.agent;
    const projectPaths = plan.repositories.map(item => item.path);
    const projectsChanged = member && JSON.stringify((member.projects || []).map(item => item.path)) !== JSON.stringify(projectPaths);
    if (!member || projectsChanged) {
      member = member ? { ...member, workspace: projectPaths[0], projects: plan.repositories.map(profile => ({ path: profile.path, name: profile.name, profile })) } : chiefOfStaffMember(receipt.memberId, plan.repositories);
      const profile = `Name: ${member.name}\nRole: ${member.role}\n${member.instructions}`;
      const prepared = await ctx.provisionAgent({ agentId: member.id, agent: member, profile }, member.workspace);
      member = { ...member, profileDocs: prepared.profileDocs, skillInstall: prepared.skillInstall };
      await ctx.agentChannelActions.setAccess(member.id, { agent: member, profile, ...(projectsChanged ? { profilePatch: { workspace: member.workspace, projects: member.projects } } : {}) });
    }
    await ctx.mutateChannelsState(current => {
      if (!current.channels.some(channel => channel.id === GENERAL_CHANNEL_ID) && !current.deletedChannelIds.includes(GENERAL_CHANNEL_ID)) {
        const now = new Date().toISOString();
        current.channels.push({ id: GENERAL_CHANNEL_ID, name: 'general', visibility: 'public', memberIds: [member.id], creatorId: 'user', purpose: 'Coordinate your projects with your Chief of Staff.', projects: plan.repositories.map(profile => ({ path: profile.path, name: profile.name, profile })), autoModeDefault: false, responder: { mode: 'lead', leadMemberId: member.id }, createdAt: now, updatedAt: now });
      }
    });
    const completed = { ...receipt, status: 'completed', completedAt: new Date().toISOString() };
    await writePersistentJson(file, completed);
    return { ...completed, member };
  });
  return { read, analyze, complete };
}
