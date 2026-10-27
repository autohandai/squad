import { z } from "zod";

export const nameSchema = z.string().trim().min(1).max(120);
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const roleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;
export const memorySchema = z.object({
  text: z.string().transform(value => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(500)),
  scope: z.enum(["team", "member", "project"]),
  memberId: idSchema.nullable().default(null),
  projectId: idSchema.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.scope === "member" && !value.memberId) context.addIssue({ code: "custom", message: "Member memory requires memberId" });
  if (value.scope === "project" && !value.projectId) context.addIssue({ code: "custom", message: "Project memory requires a stable projectId" });
});
export const mutationSchema = z.object({
  baseRevision: z.number().int().nonnegative().safe(),
  content: memorySchema.nullable(),
}).strict();
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1), id: idSchema, tenantId: z.string().uuid(), workspaceId: z.string().uuid(),
  scope: z.enum(["team", "member", "project"]),
  revision: z.number().int().positive(), deleted: z.boolean(), content: memorySchema.nullable(),
  updatedBy: z.string().uuid(), updatedAt: z.string().datetime(),
});
export type MemorySnapshot = z.infer<typeof snapshotSchema>;

const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
export const channelSchema = z.enum(["stable", "nightly"]);
export const releaseSchema = z.object({
  schemaVersion: z.literal(1), channel: channelSchema, version: semver,
  releasedAt: z.string().datetime(), notes: z.string().max(60_000),
  releaseUrl: z.url().startsWith("https://github.com/autohandai/squad/releases/tag/"),
  assets: z.array(z.object({
    os: z.enum(["macos", "windows", "linux"]), arch: z.enum(["arm64", "x64"]),
    name: z.string().regex(/^autohand-squad-[a-zA-Z0-9._-]+$/),
    url: z.url().startsWith("https://github.com/autohandai/squad/releases/download/"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(2 * 1024 ** 3),
  }).strict()).min(1).max(12),
}).strict();
export type ReleaseManifest = z.infer<typeof releaseSchema>;
