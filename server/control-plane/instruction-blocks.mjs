// Member instructions that do not fit (ADR-0257).
//
// A member's operating instructions hold at most 1,200 characters
// (PROFILE_LIMITS.instructions) and each profile memory at most 500. Agents
// drafting a member, the Chief of Staff most of all, write long briefs: on
// 18 Nov 2026 two `squad_create_member` calls for "Thiago" were refused by the
// tool schema with "arguments.instructions is longer than 1200 characters",
// the agent resent the same text, and the run ended Failed. Refusing teaches
// nothing a model reliably acts on, so the tools now keep the first part as the
// instructions, cut at a paragraph or sentence, and save the rest as numbered
// profile memories in blocks that fit, and say so in their reply.
import { PROFILE_LIMITS } from '../../src/lib/member-shaping.js';

export const INSTRUCTIONS_LIMIT = PROFILE_LIMITS.instructions;
export const MEMORY_LIMIT = 500;
export const MAX_MEMORIES = 100;
/** What the tool schema accepts before splitting (40 blocks of overflow). */
export const INSTRUCTIONS_INPUT_LIMIT = 20000;
const PREFIX = 'Operating instructions, continued';
const label = (index, total) => `${PREFIX} (${index}/${total}): `;
export const isContinuation = text => String(text || '').startsWith(PREFIX);

/** The last good cut at or before `limit`: a paragraph, a line, a sentence, a word. */
function cut(text, limit) {
  if (text.length <= limit) return text.length;
  const window = text.slice(0, limit + 1);
  for (const pattern of [/\n\s*\n(?![\s\S]*\n\s*\n)/, /\n(?![\s\S]*\n)/, /[.!?](?=\s)(?![\s\S]*[.!?]\s)/, /\s(?![\s\S]*\s)/]) {
    const match = window.match(pattern);
    // A cut in the first third would leave a stub; look for a later boundary.
    if (match && match.index + match[0].length > limit / 3) return Math.min(limit, match.index + match[0].length);
  }
  return limit;
}

/**
 * Split instructions into what fits as instructions and the memory blocks
 * that carry the rest, in order. Returns `split: null` when nothing moved.
 */
export function fitInstructions(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length <= INSTRUCTIONS_LIMIT) return { instructions: text, blocks: [], split: null };
  const head = cut(text, INSTRUCTIONS_LIMIT);
  const instructions = text.slice(0, head).trim();
  let rest = text.slice(head).trim();
  // Room for the longest label ("… (99/99): ").
  const room = MEMORY_LIMIT - label(99, 99).length;
  const parts = [];
  while (rest) {
    const at = cut(rest, room);
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  const blocks = parts.filter(Boolean).map((part, index, all) => `${label(index + 1, all.length)}${part}`);
  return {
    instructions, blocks,
    split: { instructionsCharacters: instructions.length, memoryBlocks: blocks.length, originalCharacters: text.length,
      note: `The instructions were ${text.length} characters; a member's instructions hold ${INSTRUCTIONS_LIMIT}. The first ${instructions.length} are saved as instructions and the rest as ${blocks.length} profile ${blocks.length === 1 ? 'memory' : 'memories'} labelled "${PREFIX}". Tell the person, in one line.` },
  };
}

/** Memories for a new member: the overflow first, then the caller's own. */
export function memoriesWith(blocks, memories = []) {
  const merged = [...blocks, ...memories];
  if (merged.length > MAX_MEMORIES) throw Object.assign(new Error(`These instructions need ${blocks.length} memory blocks and ${memories.length} memories were also given; a member holds ${MAX_MEMORIES}. Shorten the instructions or send fewer memories.`), { status: 400 });
  return merged;
}

/** On an update: drop earlier continuation blocks, keep every other memory. */
export function replaceContinuations(current = [], blocks = []) {
  const kept = current.map(item => (typeof item === 'string' ? item : item?.text)).filter(text => typeof text === 'string' && !isContinuation(text));
  return memoriesWith(blocks, kept);
}
