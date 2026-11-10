import type { z } from 'zod';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export interface Owner { kind: 'user' | 'team'; issuer: string; id: string }
export interface FileRef { id: string; path: string; kind: 'profile' | 'memory' | 'skill' | 'artifact' | 'attachment' | 'conversation' | 'other'; sha256: string; bytes: number; mediaType: string }
export interface ScopedFileRef extends FileRef { agentId: string | null }
export interface Agent { id: string; profile: JsonObject; memories: JsonObject[]; conversations: JsonObject[]; routines: JsonObject[]; skills: JsonObject[]; files: FileRef[]; extensions: JsonObject }
export interface SquadState { shared: { data: JsonObject; files: FileRef[] }; workspaces: { id: string; label: string; pathHint: string }[]; omissions: { path: string; reason: string }[]; extensions: JsonObject }
export interface Manifest extends SquadState { format: 'autohand-squad'; schemaVersion: 1; createdAt: string; owner: Owner; agents: Agent[] }
export interface Backup extends Manifest { files: { agentId: string | null; id: string; encoding: 'base64'; content: string }[] }
export const FORMAT: 'autohand-squad';
export const SCHEMA_VERSION: 1;
export const MAX_FILE_BYTES: number;
export const MAX_DOCUMENT_BYTES: number;
export const ownerSchema: z.ZodType<Owner>;
export const fileSchema: z.ZodType<FileRef>;
export const agentSchema: z.ZodType<Agent>;
export const manifestSchema: z.ZodType<Manifest>;
export const stateSchema: z.ZodType<SquadState>;
export const backupSchema: z.ZodType<Backup>;
export function backupJsonSchema(): Record<string, unknown>;
export function validateAgent(value: unknown): Agent;
export function checkStructure(value: unknown, maxNodes?: number): void;
export function validateManifest(value: unknown): Manifest;
export function validateState(value: unknown): SquadState;
export function validateBackup(value: unknown): Backup;
export function verifyBackup(value: unknown): Promise<Backup>;
export function inventory(value: Pick<Manifest, 'agents' | 'shared'>): ScopedFileRef[];
export function decodeFile(file: Backup['files'][number]): Uint8Array;
export function sha256(bytes: Uint8Array): Promise<string>;
export function parseBackup(text: string, format: 'json' | 'yaml'): Promise<Backup>;
export function encodeBackup(value: unknown, format: 'json' | 'yaml'): string;
export function streamBackup(value: unknown, format: 'json' | 'yaml', readFile: (file: ScopedFileRef) => Promise<AsyncIterable<Uint8Array>>, options?: { createDigest?: (file: FileRef) => { write(chunk: Uint8Array): void | Promise<void>; finish(): string | Promise<string>; cancel?(): void | Promise<void> } }): AsyncGenerator<string>;
