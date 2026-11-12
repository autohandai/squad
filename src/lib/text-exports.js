const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const isDesktop = userAgent => /^AutohandSquadDesktop\//.test(userAgent);
function validFilename(filename) {
  return typeof filename === "string" && filename.length > 0 && new TextEncoder().encode(filename).length <= 180 && filename === filename.trim() && !/[\\/:\x00-\x1f\x7f]/.test(filename) && /\.(md|json)$/.test(filename);
}

/** Only the native receipt may say a desktop file was saved. */
export async function saveTextExport(filename, content, {
  userAgent = globalThis.navigator?.userAgent || "",
  invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke,
  document = globalThis.document,
  url = globalThis.URL,
  scheduleCleanup = callback => { const timer = setTimeout(callback, 60_000); timer.unref?.(); },
} = {}) {
  if (!validFilename(filename) || typeof content !== "string") throw new Error("Choose a Markdown or JSON export with a valid filename.");
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_TEXT_BYTES) throw new Error("This text export is larger than 32 MB. Export a smaller conversation.");
  if (isDesktop(userAgent)) {
    if (typeof invoke !== "function") throw new Error("Update Squad to save this export from the desktop app.");
    let receipt;
    try { receipt = await invoke("squad_save_text_export", { filename, content }); }
    catch (error) { throw new Error(typeof error === "string" ? error : error?.message || "Squad could not save the export. Update the desktop app and try again."); }
    if (receipt?.saved !== true || !validFilename(receipt.filename) || receipt.bytes !== bytes) throw new Error("Squad did not confirm that the complete export was saved.");
    return { saved: true, filename: receipt.filename };
  }
  const blob = new Blob([content], { type: filename.endsWith(".json") ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
  const href = url.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  try { document.body.append(anchor); anchor.click(); }
  finally {
    anchor.remove();
    // The browser consumes blob URLs asynchronously after the click returns.
    scheduleCleanup(() => url.revokeObjectURL(href));
  }
  return { requested: true, filename };
}

/** Preserve partial results: one failed JSON save cannot erase a saved log. */
export async function saveTextExports(files, options) {
  const results = await Promise.allSettled(files.map(file => saveTextExport(file.filename, file.content, options)));
  const succeeded = [];
  const failed = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") succeeded.push(result.value);
    else failed.push({ filename: files[index].filename, error: result.reason?.message || String(result.reason) });
  }
  const saved = succeeded.filter(file => file.saved).map(file => file.filename);
  const requested = succeeded.filter(file => file.requested).map(file => file.filename);
  const message = [
    saved.length ? `Saved in Downloads: ${saved.join(", ")}.` : "",
    requested.length ? `Download requested: ${requested.join(", ")}. Check your browser's downloads.` : "",
    ...failed.map(file => `Could not export ${file.filename}: ${file.error}`),
  ].filter(Boolean).join(" ");
  return { succeeded, failed, message };
}
