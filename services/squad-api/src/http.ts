import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function requireValue(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
export async function body<T>(request: Pick<Request, "headers" | "body">, schema: z.ZodType<T>, limit = 128 * 1024): Promise<T> {
  requireValue(request.headers.get("content-type")?.split(";")[0].trim() === "application/json", 415, "json_required", "Send application/json.");
  requireValue(Number(request.headers.get("content-length") || 0) <= limit, 413, "body_too_large", "Request is too large.");
  const reader = request.body?.getReader();
  requireValue(reader, 400, "invalid_json", "A JSON body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "body_too_large", "Request is too large."); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, "invalid_json", "Send valid JSON."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Request validation failed.", parsed.error.issues.map(issue => ({ path: issue.path, message: issue.message })));
  return parsed.data;
}
export const ok = (data: unknown, status = 200, headers: HeadersInit = {}) => Response.json({ success: true, data }, { status, headers });
export async function digest(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function token(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function equalSecret(left: string, right: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(right), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(right));
  return crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(left));
}
