// Types for src/lib/marketplace.js, for services/squad-api (TypeScript).
export interface TeamDocument {
  format: string; version: number; kind: string;
  team: { name: string; description: string; lead: string; exportedAt: string; app: string };
  members: Array<{ key: string; name: string; role: string; description: string; instructions: string; brainCard: Record<string, string>; look: { avatar: string; employeeType: string }; skills: string[]; harness: { id: string }; notes?: string }>;
  skills: Array<{ name: string; description: string; text: string }>;
  channels: unknown[]; workflows: unknown[]; presets: unknown[]; routines: unknown[]; connectors: unknown[];
}
export interface ListingInput { tagline: string; description: string; category: string; tags: string[] }
export type MarketplaceRequest = { kind: "marketplace"; id: string; version?: number; sha256?: string };
export const TEMPLATE_LIMITS: Readonly<{ bytes: number; skills: number; notes: number; tagline: number; description: number; tags: number; tag: number; name: number; note: number }>;
export const CATEGORIES: ReadonlyArray<{ id: string; label: string }>;
export const CATEGORY_IDS: ReadonlyArray<string>;
export const CREATOR_KINDS: ReadonlyArray<string>;
export const LISTING_STATUSES: ReadonlyArray<string>;
export const REPORT_REASONS: ReadonlyArray<{ id: string; label: string }>;
export const REPORT_REASON_IDS: ReadonlyArray<string>;
export const AUTOHAND_CREATOR_NAME: string;
export const LISTING_ID: RegExp;
export const SHA256_HEX: RegExp;
export const BIRD_AVATAR: RegExp;
export function canonicalJson(value: unknown): string;
export function sha256Hex(text: string): Promise<string>;
export function contentHash(document: unknown): Promise<string>;
export function byteLength(text: string): number;
export function seedListingId(slug: string): Promise<string>;
export function randomListingId(): string;
export function categoryLabel(id: string): string;
export function birdFromTemplateAvatar(avatar: string): string;
export function secretFindings(value: unknown): Array<{ path: string; kinds: string[] }>;
export function validateAgentTemplate(input: unknown):
  | { ok: true; document: TeamDocument; bytes: number }
  | { ok: false; code: string; error: string; findings?: Array<{ path: string; kinds: string[] }> };
export function templateSummary(document: TeamDocument): { name: string; role: string; bird: string; skills: Array<{ name: string; description: string }>; hasMemory: boolean; instructions: string; brainCard: Record<string, string> };
export function validateListingInput(input: unknown): { ok: true; listing: ListingInput } | { ok: false; error: string };
export function buildDeepLink(request: { id: string; version?: number; sha256?: string }): string;
export function parseDeepLink(text: string): MarketplaceRequest | null;
