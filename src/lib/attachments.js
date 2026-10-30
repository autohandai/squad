// The stored file is the source of truth. Chat state and queues carry small
// references, never File objects, blob URLs or base64 content.
export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_COUNT_LIMIT = 20;
export const ATTACHMENT_ID = /^[a-z0-9]{12,32}$/;

const types = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ods: "application/vnd.oasis.opendocument.spreadsheet",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", xml: "application/xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

export function attachmentMime(name, mime = "") {
  const extension = String(name || "").split(".").at(-1).toLowerCase();
  const given = String(mime || "").split(";")[0].trim().toLowerCase();
  return types[extension] || (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(given) ? given : "application/octet-stream");
}

export function attachmentLabel(file) {
  const extension = String(file?.name || "").split(".").at(-1).toUpperCase();
  return extension.length <= 8 ? extension : "FILE";
}

export function attachmentSize(size) {
  const bytes = Number(size) || 0;
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;
}

export function attachmentReferences(files = []) {
  return (Array.isArray(files) ? files : []).map(file => typeof file === "string" ? { id: file } : file)
    .filter(file => file && ATTACHMENT_ID.test(file.id || ""))
    .slice(0, ATTACHMENT_COUNT_LIMIT)
    .map(file => ({ id: file.id, name: String(file.name || ""), mime: attachmentMime(file.name, file.mime), kind: file.kind || "file", size: Number(file.size) || 0, url: `/api/attachments/${file.id}`, ...Object.fromEntries(["width", "height", "durationMs", "createdAt"].filter(key => file[key] != null).map(key => [key, file[key]])), ...(file.previewUrl ? { previewUrl: `/api/attachments/${file.id}/preview` } : {}) }));
}

export function attachmentOnlyPrompt(files) {
  return `Please review ${files.length === 1 ? "the attached file" : "the attached files"}: ${files.map(file => file.name).join(", ")}.`;
}

export function transferHasFiles(transfer) {
  return Boolean(transfer && (Array.from(transfer.types || []).includes("Files") || transfer.files?.length));
}
