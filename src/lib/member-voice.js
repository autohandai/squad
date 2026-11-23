// Each member's reading voice (ADR-0276): the ten voices of kale-tts-1 and the
// rule that gives a member one when nobody chose it. Shared by the app, the
// bridge (member creation, MCP) and the phone host, so a member sounds the same
// everywhere.
//
// The default follows the member's name (a female name gets a woman's voice, a
// male name a man's), then its role, description and personality (a research
// analyst gets a crisp news voice, a growth lead a bright one), and voices
// already taken by other members are avoided while any are left: with ten
// voices, up to five women and five men each sound different.

import { FEMALE_NAMES, MALE_NAMES } from "./name-genders.js";

export const KALE_VOICES = Object.freeze([
  { id: "s057b", name: "Kenzie", gender: "female", accent: "American", description: "Energetic and upbeat",
    traits: ["marketing", "growth", "social", "community", "content", "brand", "sales", "events", "hype", "creator", "design", "designer", "creative", "ux"] },
  { id: "f06", name: "Simone", gender: "female", accent: "American", description: "Deep and confident",
    traits: ["chief", "lead", "head", "director", "principal", "staff", "manager", "strategy", "executive", "architect", "founder", "confident"] },
  { id: "d03", name: "Amy", gender: "female", accent: "British", description: "Crisp and clear, like a newsreader",
    traits: ["analyst", "research", "writer", "editor", "docs", "documentation", "legal", "finance", "compliance", "report", "data", "british"] },
  { id: "w165", name: "Frankie", gender: "female", accent: "American", description: "Wry and street-smart",
    traits: ["security", "qa", "quality", "test", "debug", "investigat", "support", "incident", "audit", "detective"] },
  { id: "w602", name: "Darlene", gender: "female", accent: "American", description: "Low, warm and weathered",
    traits: ["devops", "infra", "infrastructure", "operations", "sre", "platform", "logistics", "build", "release", "reliability"] },
  { id: "m3", name: "Owen", gender: "male", accent: "American", description: "Bright and friendly",
    traits: ["marketing", "growth", "community", "customer", "success", "sales", "onboarding", "host", "frontend", "friendly"] },
  { id: "t071", name: "Toby", gender: "male", accent: "American", description: "Playful and quick",
    traits: ["design", "designer", "creative", "prototype", "ux", "ui", "junior", "intern", "game", "playful", "fun"] },
  { id: "d13", name: "Jack", gender: "male", accent: "British", description: "Crisp and clear, like a newsreader",
    traits: ["analyst", "research", "writer", "docs", "documentation", "finance", "legal", "product", "report", "data", "british"] },
  { id: "x328", name: "Earl", gender: "male", accent: "American", description: "Warm and unhurried, a seasoned mentor",
    traits: ["mentor", "coach", "advisor", "reviewer", "review", "senior", "people", "hr", "teacher", "historian", "calm", "patient"] },
  { id: "h013f", name: "Magnus", gender: "male", accent: "American", description: "Deep and dramatic",
    traits: ["chief", "principal", "architect", "lead", "head", "director", "cto", "ceo", "founder", "narrator", "story", "engineer", "backend"] },
]);

const BY_ID = new Map(KALE_VOICES.map((voice) => [voice.id, voice]));

/** A voice by id or by name ("amy", "d03"), or null. */
export function voiceById(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  return BY_ID.get(key) || KALE_VOICES.find((voice) => voice.name.toLowerCase() === key) || null;
}

/** "female", "male" or "" from the first word of a name. */
export function nameGender(name) {
  const first = String(name || "").trim().split(/[\s\-_.]+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!first) return "";
  if (FEMALE_NAMES.has(first)) return "female";
  if (MALE_NAMES.has(first)) return "male";
  // Endings that usually hold across Romance and Slavic names.
  if (/(?:ia|ina|ella|ette|anne|elle)$/.test(first) || (/a$/.test(first) && first.length > 3)) return "female";
  if (/(?:o|os|us|son|ton)$/.test(first) && first.length > 3) return "male";
  return "";
}

/** A gender stated in the member's personality wins over its name ("she", "a woman"). */
function statedGender(text) {
  const words = ` ${String(text || "").toLowerCase()} `;
  const female = (words.match(/\b(she|her|hers|woman|female|girl|lady)\b/g) || []).length;
  const male = (words.match(/\b(he|him|his|man|male|boy|gentleman|guy)\b/g) || []).length;
  return female > male ? "female" : male > female ? "male" : "";
}

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.codePointAt(0), 16777619) >>> 0;
  return value;
}

function personalityOf(member) {
  const persona = (member?.profileFiles || []).find((file) => file?.section === "persona")?.content || member?.personality || "";
  return persona;
}

/**
 * The best voice for one member, avoiding `taken` while possible.
 * member: { id, name, role, description, personality | profileFiles }
 */
export function defaultVoiceFor(member = {}, taken = new Set()) {
  const persona = personalityOf(member);
  const gender = statedGender(persona) || nameGender(member.name);
  const text = `${member.role || ""} ${member.description || ""} ${persona}`.toLowerCase();
  const pool = gender ? KALE_VOICES.filter((voice) => voice.gender === gender) : KALE_VOICES;
  const free = pool.filter((voice) => !taken.has(voice.id));
  const choices = free.length ? free : pool;
  const seed = hash(member.id || member.name || "member");
  const scored = choices.map((voice, index) => ({
    voice,
    score: voice.traits.reduce((sum, trait) => sum + (text.includes(trait) ? 1 : 0), 0),
    tie: (seed + index * 2654435761) >>> 0,
  }));
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return scored[0].voice.id;
}

/**
 * Every member's voice: the one saved on the member when it names a known
 * voice, else a default given in the order members joined, so adding a member
 * never changes an earlier member's voice. Returns Map(id -> voice id).
 */
export function memberVoices(members = []) {
  const list = (Array.isArray(members) ? members : []).filter((member) => member?.id);
  const result = new Map();
  const taken = new Set();
  for (const member of list) {
    const chosen = voiceById(member.voice);
    if (chosen) { result.set(member.id, chosen.id); taken.add(chosen.id); }
  }
  const order = list.filter((member) => !result.has(member.id))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
  for (const member of order) {
    const voice = defaultVoiceFor(member, taken);
    result.set(member.id, voice);
    taken.add(voice);
  }
  return result;
}

/** One member's voice within its squad. */
export function voiceForMember(member, members = []) {
  const chosen = voiceById(member?.voice);
  if (chosen) return chosen.id;
  const all = members.some((other) => other?.id === member?.id) ? members : [...members, member];
  return memberVoices(all).get(member?.id) || KALE_VOICES[0].id;
}

const cache = new WeakMap();
/** memberVoices(members), remembered for the same roster array (render paths call it per message). */
export function cachedMemberVoices(members = []) {
  if (!Array.isArray(members)) return new Map();
  let voices = cache.get(members);
  if (!voices) { voices = memberVoices(members); cache.set(members, voices); }
  return voices;
}
