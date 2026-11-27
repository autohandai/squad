// The agent marketplace on a paired phone (contract 0.5, ADR-0256).
//
// The phone browses through this computer, never the marketplace API
// directly: the computer already caches listings with a last-good copy
// (ADR-0246), and the phone holds no account credential. Reads are shaped to
// what the phone draws. "Add" is a decision, not an install: it is recorded
// here, and the Squad window carries it out through the same import the
// desktop's Add uses (members are only ever created in the window, ADR-0077;
// the same handoff as team cards, ADR-0252). The phone shows the listing's
// skills and what it may touch before the person taps Add, so that tap is the
// consent; the Mac does not ask a second time.
import { z } from 'zod';
import { agentFieldsFromTemplate } from '../../src/lib/marketplace.js';

const LISTING_ID = /^[a-z0-9]{12}$/;
const CATEGORY = /^[a-z][a-z0-9-]{0,39}$/;
const BIRD = /^[a-z]{2,24}$/;
const MAX_REQUESTS = 30;

const text = (value, limit) => { const clean = String(value ?? '').replace(/\s+/g, ' ').trim(); return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean; };
const bird = value => (BIRD.test(String(value || '')) ? String(value) : 'kiwi');

/** One row as the phone draws it. Unknown fields are dropped. */
export function phoneListing(item = {}) {
  const team = item.kind === 'team';
  return {
    id: String(item.id || ''),
    kind: team ? 'team' : 'agent',
    name: text(item.name, 80),
    role: text(item.role, 120),
    tagline: text(item.tagline, 240),
    category: String(item.category || ''),
    categoryLabel: text(item.categoryLabel, 60),
    bird: bird(item.bird),
    faces: team ? (Array.isArray(item.faces) ? item.faces.map(bird).slice(0, 6) : [bird(item.bird)]) : [],
    members: Number.isInteger(item.members) && item.members > 0 ? item.members : 1,
    creator: text(item.creator?.name, 80),
    creatorIsAutohand: item.creator?.kind === 'autohand',
    installsLabel: text(item.installsLabel, 40),
    version: Number.isInteger(item.version) ? item.version : 0,
    createdAt: String(item.createdAt || ''),
  };
}
const rows = list => (Array.isArray(list) ? list.filter(item => LISTING_ID.test(String(item?.id || ''))).map(phoneListing) : []);

export function phoneHome(home = {}, { canAdd }) {
  const sections = (Array.isArray(home.sections) ? home.sections : []).filter(section => CATEGORY.test(String(section?.id || ''))).map(section => ({
    id: section.id, label: text(section.label, 60),
    // The count of the agents its list shows; teams are counted under Teams
    // (the website's rule, so a chip and its list never disagree).
    count: Number.isInteger(section.count) ? section.count : 0,
    listings: rows(section.agents),
  }));
  return {
    featured: rows(home.featured), teams: rows(home.teams), sections,
    total: Number.isInteger(home.total) ? home.total : 0,
    teamsTotal: Number.isInteger(home.teamsTotal) ? home.teamsTotal : 0,
    stale: Boolean(home.stale), canAdd,
  };
}

export function phoneDetail(detail = {}) {
  const listing = phoneListing(detail.agent || {});
  const preview = detail.preview || {};
  const card = preview.brainCard || {};
  const skill = item => ({ name: text(item?.name ?? item, 80), detail: text(item?.description, 240) });
  return {
    listing: { ...listing, description: text(detail.agent?.description, 1200), tags: (detail.agent?.tags || []).map(tag => text(tag, 30)).slice(0, 8) },
    purpose: text(card.purpose, 400),
    mayUse: text(card.allowedTools, 400),
    asksFirst: text(card.escalationRules, 400),
    skills: (Array.isArray(preview.skills) ? preview.skills : []).map(skill).filter(item => item.name).slice(0, 20),
    members: (Array.isArray(preview.members) ? preview.members : []).map(member => ({
      name: text(member.name, 80), role: text(member.role, 120), bird: bird(member.bird), lead: Boolean(member.lead),
    })).slice(0, 20),
    hasMemory: Boolean(preview.hasMemory),
  };
}

const failure = error => {
  const code = error?.code || error?.details?.code || '';
  // Never an account change (ADR-0246 amendment): the phone shows a calm line.
  if (code === 'marketplace_unavailable' || code === 'marketplace_sign_in' || /unavailable|sign in/i.test(String(error?.message || ''))) {
    return Error('The marketplace can’t be reached from your computer right now. Try again in a minute.');
  }
  if (code === 'listing_not_found' || /not in the marketplace|not a marketplace agent/i.test(String(error?.message || ''))) return Error('This agent is no longer in the marketplace.');
  return Error(String(error?.message || 'The marketplace did not answer.'));
};

/** One of the person's own listings (contract 0.12): its status as the desktop's Published tab shows it. */
export function phoneOwnListing(item = {}) {
  const status = ['published', 'unpublished', 'hidden'].includes(item.status) ? item.status : 'unpublished';
  return { ...phoneListing(item), status, moderationReason: text(item.moderationReason, 240), updatedAt: String(item.updatedAt || ''),
    link: LISTING_ID.test(String(item.id || '')) ? `https://autohand.ai/squad/marketplace/${item.id}/` : '' };
}

/** What will be public, read from the template the computer built (never the member record itself). */
export function phonePublishPreview(built = {}, memberSkills = []) {
  const fields = agentFieldsFromTemplate(built.document || {});
  return {
    name: text(fields.name, 80), role: text(fields.role, 120), bird: bird(fields.bird),
    instructions: String(fields.instructions || '').slice(0, 4000),
    purpose: text(fields.brainCard?.purpose, 400),
    skills: (Array.isArray(built.skills) ? built.skills : []).map(skill => ({ name: text(skill?.name, 80), detail: text(skill?.description, 240) })).filter(skill => skill.name).slice(0, 20),
    memberSkills: memberSkills.map(name => text(name, 80)).filter(Boolean).slice(0, 32),
    missingSkills: (Array.isArray(built.missingSkills) ? built.missingSkills : []).map(name => text(name, 80)).slice(0, 20),
    memory: String(built.memory || '').slice(0, 4000), memoryTruncated: Boolean(built.memoryTruncated),
    findings: (Array.isArray(built.findings) ? built.findings : []).slice(0, 20).map(finding => ({ path: text(finding?.path, 120), kinds: (finding?.kinds || []).map(kind => text(kind, 40)).slice(0, 4) })),
    problem: text(built.error, 400),
    contentHash: String(built.contentHash || ''),
  };
}

export function requestView(entry) {
  return {
    id: entry.id, listingID: entry.listingId, kind: entry.listingKind, name: entry.name,
    state: entry.state, result: entry.result || null, requestedAt: entry.decidedAt,
  };
}

/**
 * The phone-facing commands. `bridge` is this computer's owned API; `cards`
 * the persistent decision store (entries of kind "marketplace").
 */
export function createPhoneMarketplace({ bridge, cards, canWrite = async () => true, emit = () => {}, confirmOnComputer = () => true, memberRecord = null }) {
  const read = async path => { try { return await bridge.get(path); } catch (error) { throw failure(error); } };
  const entries = () => (cards ? cards.entries().filter(entry => entry.kind === 'marketplace') : []);

  async function execute(command, parameters, { deviceID = '', requestID = '' } = {}) {
    if (command === 'marketplace.home') {
      z.object({}).strict().parse(parameters || {});
      const [home, writable] = await Promise.all([read('/api/marketplace/home'), canWrite().catch(() => false)]);
      return { ...phoneHome(home, { canAdd: Boolean(cards) && writable }), confirmsOnComputer: confirmOnComputer() };
    }
    if (command === 'marketplace.list') {
      const value = z.object({
        q: z.string().max(80).optional(), category: z.string().regex(CATEGORY).optional(),
        kind: z.enum(['agent', 'team', 'all']).optional(), creator: z.enum(['autohand']).optional(),
        cursor: z.string().max(400).optional(),
      }).strict().parse(parameters || {});
      const query = new URLSearchParams({ limit: '24', kind: value.kind || 'agent' });
      if (value.q?.trim()) query.set('q', value.q.trim());
      if (value.category) query.set('category', value.category);
      if (value.creator) query.set('creator', value.creator);
      if (value.cursor) query.set('cursor', value.cursor);
      const page = await read(`/api/marketplace/agents?${query}`);
      return { listings: rows(page.agents), total: Number.isInteger(page.total) ? page.total : 0, nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null };
    }
    if (command === 'marketplace.listing') {
      const { id } = z.object({ id: z.string().regex(LISTING_ID) }).strict().parse(parameters);
      const detail = phoneDetail(await read(`/api/marketplace/agents/${id}`));
      const added = (await bridge.get('/api/marketplace/imports').catch(() => ({ imports: [] }))).imports || [];
      const mine = added.filter(receipt => receipt.listingId === id).at(-1);
      const pending = entries().filter(entry => entry.listingId === id).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0];
      return { ...detail, added: mine ? { memberName: text(mine.memberName, 80), at: String(mine.at || '') } : null, request: pending ? requestView(pending) : null };
    }
    if (command === 'marketplace.requests') {
      z.object({}).strict().parse(parameters || {});
      return { requests: entries().sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).slice(0, MAX_REQUESTS).map(requestView) };
    }
    if (command === 'marketplace.add') {
      if (!cards) throw Error('Adding from a phone needs a newer Squad on your computer.');
      if (!await canWrite().catch(() => false)) throw Error('This Squad is read-only for you, so agents can’t be added to it.');
      const { id } = z.object({ id: z.string().regex(LISTING_ID) }).strict().parse(parameters);
      const { agent } = await read(`/api/marketplace/agents/${id}`);
      if (!agent) throw Error('This agent is no longer in the marketplace.');
      const cardID = `marketplace:${deviceID}:${requestID || Date.now()}`;
      const entry = await cards.set(cardID, {
        kind: 'marketplace', listingId: id, listingKind: agent.kind === 'team' ? 'team' : 'agent', name: text(agent.name, 80),
        version: Number.isInteger(agent.version) ? agent.version : 0, contentHash: String(agent.contentHash || ''),
        // With "Confirm phone adds on this Mac" on (the default), the window
        // opens the desktop's own review and nothing is added until the
        // person confirms there; off, the window adds it as decided here.
        confirm: confirmOnComputer(),
        state: 'requested', result: confirmOnComputer()
          ? 'Waiting for you to confirm it in Squad on your computer.'
          : 'Waiting for Squad on your computer to add it. Keep Squad open there.',
        desktopApplied: false, decidedAt: new Date().toISOString(), source: 'phone',
      });
      emit('mobile.decisions.changed');
      return { request: requestView({ id: cardID, ...entry }) };
    }
    // Publishing from the phone (contract 0.12, ADR-0290): the computer builds
    // the template from its own member record, runs the same secret scan, and
    // publishes as the signed-in account. The phone only ever sees the preview.
    const memberIDSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const publishInput = {
      memberID: memberIDSchema,
      skills: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
      includeMemory: z.boolean().default(false),
      tagline: z.string().max(400).default(''),
    };
    async function record(id) {
      if (!memberRecord) throw Error('Publishing from a phone needs a newer Squad on your computer.');
      const agent = await memberRecord(id);
      if (!agent) throw Error('This member is no longer in this Squad.');
      return agent;
    }
    const skillNames = agent => (Array.isArray(agent.skills) ? agent.skills : []).map(skill => String(skill?.name || skill?.id || skill || '')).filter(Boolean);
    async function mineRows() {
      try { return (await bridge.get('/api/marketplace/mine')).agents || []; } catch { return []; }
    }
    if (command === 'marketplace.publish.context') {
      const { memberID } = z.object({ memberID: memberIDSchema }).strict().parse(parameters);
      const agent = await record(memberID);
      const [context, categories, mine] = await Promise.all([
        bridge.get('/api/marketplace/publish/context').catch(error => ({ signedIn: false, owners: [], error: failure(error).message })),
        bridge.get('/api/marketplace/categories').catch(() => ({ categories: [] })),
        mineRows(),
      ]);
      const previous = mine.find(item => item.name === agent.name && ['published', 'unpublished'].includes(item.status));
      return {
        signedIn: Boolean(context.signedIn), problem: context.signedIn ? '' : text(context.error || 'Sign in to Autohand on your computer to publish.', 240),
        owners: (context.owners || []).map(owner => ({ kind: owner.kind === 'team' ? 'team' : 'user', id: String(owner.id || ''), label: text(owner.label, 80) })),
        categories: (categories.categories || []).filter(item => CATEGORY.test(String(item?.id || ''))).map(item => ({ id: item.id, label: text(item.label, 60) })),
        previous: previous ? phoneOwnListing(previous) : null,
        member: { name: text(agent.name, 80), role: text(agent.role, 120), tagline: text(agent.description, 240) },
      };
    }
    if (command === 'marketplace.publish.preview') {
      const value = z.object(publishInput).strict().parse(parameters);
      const agent = await record(value.memberID);
      const built = await bridge.post('/api/marketplace/publish/preview', { member: agent, skills: value.skills ?? skillNames(agent), includeMemory: value.includeMemory, tagline: value.tagline });
      return phonePublishPreview(built, skillNames(agent));
    }
    if (command === 'marketplace.publish') {
      const value = z.object({
        ...publishInput,
        tagline: z.string().trim().min(1).max(400),
        description: z.string().max(4000).default(''),
        category: z.string().regex(CATEGORY),
        tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
        owner: z.object({ kind: z.enum(['user', 'team']), id: z.string().max(200).optional() }).strict().default({ kind: 'user' }),
        asNewVersion: z.boolean().default(true),
        note: z.string().max(400).default(''),
      }).strict().parse(parameters);
      const agent = await record(value.memberID);
      const previous = value.asNewVersion ? (await mineRows()).find(item => item.name === agent.name && ['published', 'unpublished'].includes(item.status)) : null;
      let result;
      try {
        result = await bridge.post('/api/marketplace/publish', {
          member: agent, skills: value.skills ?? skillNames(agent), includeMemory: value.includeMemory, note: value.note,
          requestId: `phone-${deviceID}-${requestID || Date.now()}`.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 128),
          listing: { tagline: value.tagline, description: value.description, category: value.category, tags: value.tags },
          ...(previous ? { listingId: previous.id, baseVersion: previous.version } : { owner: value.owner.kind === 'team' && value.owner.id ? { kind: 'team', id: value.owner.id } : { kind: 'user' } }),
        });
      } catch (error) { throw failure(error); }
      emit('mobile.marketplace.changed');
      return { listing: phoneOwnListing({ ...result.agent, status: 'published' }), updated: Boolean(previous) };
    }
    if (command === 'marketplace.mine') {
      z.object({}).strict().parse(parameters || {});
      let rows;
      try { rows = (await bridge.get('/api/marketplace/mine')).agents || []; } catch (error) {
        const problem = failure(error).message;
        return { signedIn: false, problem: /sign in/i.test(String(error?.message || '')) ? 'Sign in to Autohand on your computer to see what you published.' : problem, listings: [] };
      }
      return { signedIn: true, problem: '', listings: rows.filter(item => LISTING_ID.test(String(item?.id || ''))).map(phoneOwnListing) };
    }
    if (command === 'marketplace.unpublish') {
      const { id } = z.object({ id: z.string().regex(LISTING_ID) }).strict().parse(parameters);
      let result;
      try { result = await bridge.delete(`/api/marketplace/agents/${id}`); } catch (error) { throw failure(error); }
      emit('mobile.marketplace.changed');
      return { id, status: String(result?.status || 'unpublished') };
    }
    return undefined;
  }

  return {
    commands: ['marketplace.home', 'marketplace.list', 'marketplace.listing', 'marketplace.requests', 'marketplace.add',
      'marketplace.publish.context', 'marketplace.publish.preview', 'marketplace.publish', 'marketplace.mine', 'marketplace.unpublish'],
    execute,
    /** Adds the window has not carried out yet. */
    pending: () => entries().filter(entry => entry.desktopApplied === false && entry.state === 'requested')
      .map(entry => ({ requestID: entry.id, listingId: entry.listingId, kind: entry.listingKind, name: entry.name, version: entry.version, contentHash: entry.contentHash, confirm: entry.confirm !== false })),
    /** One window carries an add out; another is refused for two minutes. */
    async claim(requestID) {
      const entry = cards?.get(requestID);
      if (!entry || entry.kind !== 'marketplace' || entry.desktopApplied !== false) return false;
      // A review open on the Mac can take a while; hold it longer than a silent add.
      if (entry.claimedAt && Date.now() - Date.parse(entry.claimedAt) < (entry.confirm === false ? 120_000 : 30 * 60_000)) return false;
      await cards.set(requestID, { claimedAt: new Date().toISOString() });
      return true;
    },
    async settle({ requestID, state, result = '' }) {
      const entry = cards?.get(requestID);
      if (!entry || entry.kind !== 'marketplace') throw Error('This add is no longer on the computer.');
      if (entry.desktopApplied) return requestView({ id: requestID, ...entry });
      const next = await cards.set(requestID, { state, result: text(result, 300) || (state === 'done' ? 'Added.' : 'Nothing was added.'), desktopApplied: true, settledAt: new Date().toISOString() });
      emit('mobile.decisions.changed');
      return requestView({ id: requestID, ...next });
    },
  };
}
