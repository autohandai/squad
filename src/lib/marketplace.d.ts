// Types for src/lib/marketplace.js, for services/squad-api (TypeScript).
export interface TeamDocument {
  format: string; version: number; kind: string;
  team: { name: string; description: string; lead: string; exportedAt: string; app: string };
  members: Array<{ key: string; name: string; role: string; description: string; instructions: string; brainCard: Record<string, string>; look: { avatar: string; employeeType: string }; skills: string[]; harness: { id: string }; notes?: string }>;
  skills: Array<{ name: string; description: string; text: string }>;
  channels: unknown[]; workflows: unknown[]; presets: unknown[]; routines: unknown[]; connectors: unknown[];
}
export interface ListingInput { tagline: string; description: string; category: string; tags: string[] }
export type ListingKind = "agent" | "team";
export type MarketplaceRequest = { kind: "marketplace"; listing: ListingKind; id: string; version?: number; sha256?: string; attribution?: string };
export interface TemplateMember { name: string; role: string; description: string; bird: string; skills: string[]; hasMemory: boolean; lead: boolean }
export interface ListingSummary {
  name: string; role: string; bird: string; skills: Array<{ name: string; description: string }>; hasMemory: boolean;
  instructions: string; brainCard: Record<string, string>; members: TemplateMember[]; channels: Array<{ name: string; members: number }>;
}
type TemplateResult = { ok: true; document: TeamDocument; bytes: number } | { ok: false; code: string; error: string; findings?: Array<{ path: string; kinds: string[] }> };
export const TEAM_TEMPLATE_LIMITS: Readonly<{ bytes: number; minMembers: number; members: number; skills: number; skillsPerMember: number; channels: number }>;
export const LISTING_KINDS: ReadonlyArray<ListingKind>;
export const ATTRIBUTION_ID: RegExp;
export function newAttributionId(): string;
export function validateTeamTemplate(input: unknown): TemplateResult;
export function validateListingTemplate(kind: string, input: unknown): TemplateResult;
export function listingSummary(kind: string, document: TeamDocument): ListingSummary;
export const TEMPLATE_LIMITS: Readonly<{ bytes: number; skills: number; notes: number; tagline: number; description: number; tags: number; tag: number; name: number; note: number }>;
export const CATEGORIES: ReadonlyArray<{ id: string; label: string }>;
export const CATEGORY_IDS: ReadonlyArray<string>;
export const LISTING_CONNECTOR_IDS: ReadonlyArray<string>;
export const LISTING_CONNECTOR_LIMIT: number;
export interface AgentFields { key?: string; name: string; role: string; bird: string; instructions: string; brainCard: Record<string, string>; skills: Array<{ name: string; description: string; text: string }>; notes: string }
export function agentTemplateFromFields(fields: Partial<AgentFields> & { tagline?: string }): { document: TeamDocument; findings: Array<{ path: string; kinds: string[] }> };
export function agentFieldsFromTemplate(document: TeamDocument): AgentFields & { key: string };
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
export function buildDeepLink(request: { id: string; version?: number; sha256?: string; attribution?: string; listing?: ListingKind }): string;
export function parseDeepLink(text: string): MarketplaceRequest | null;
