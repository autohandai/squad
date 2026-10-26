// Product defaults, independent of the build machine and of any demo squad.
import { roleTemplates } from './member-profiles.js';
import { needsOf, suggestRoles, NEED_HELP } from './squad-recruiting.js';

export const GENERAL_CHANNEL_ID = 'channel_general';

/** Recommendations are data only. Selecting projects never creates members. */
export function recommendTeammates(profiles = [], templates = roleTemplates) {
  const needs = needsOf(profiles);
  if (!needs.length) return [];
  return suggestRoles({ needs }, templates.filter(item => item.id !== 'chief-of-staff'), templates.length)
    .filter(item => item.needs.length)
    .slice(0, 4)
    .map(({ template, needs: served }) => ({
      template,
      needs: served,
      repositories: profiles.filter(profile => profile.needs?.some(need => served.includes(need))).map(profile => ({ path: profile.path, name: profile.name })),
      reason: `Helps with ${served.map(need => NEED_HELP[need] || need).join(' and ')}.`,
    }));
}

export function chiefOfStaffMember(id, profiles, now = new Date().toISOString()) {
  const template = roleTemplates.find(item => item.id === 'chief-of-staff');
  return {
    id, name: 'Chief of Staff', role: template.title, employeeType: template.id,
    staffId: 'member-001', status: 'online', createdAt: now, updatedAt: now,
    avatar: '/avatars/birds/tui.webp', avatarVersion: 1,
    harness: { id: 'autohand', version: 1, model: '', access: '', effort: '' },
    workspace: profiles[0].path,
    projects: profiles.map(profile => ({ path: profile.path, name: profile.name, addedAt: now, profile })),
    description: template.description, instructions: template.starter,
    brainCard: template.brainCard, profileFiles: template.profileFiles,
    skills: [], memory: [], skillSource: template.skillSource,
    modelAssignment: { mode: 'inherit' },
    launch: { mode: 'prompt', policy: 'yes', model: '', dryRun: false },
    stats: { activeDays: 0, automations: 0, tasks: 0, projects: profiles.length },
    tools: [{ name: 'Autohand CLI', policy: 'restricted', status: 'isolated' }],
  };
}
