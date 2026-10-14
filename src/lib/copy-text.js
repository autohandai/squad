// Copy text and say whether it worked (bug hunt 2026-10, #92). Where the
// clipboard API is missing (plain http, some webviews) `clipboard?.writeText`
// resolved to nothing and buttons said "Copied" for a copy that never
// happened; this falls back to a hidden selection and returns the truth.
export async function copyText(text) {
  const value = String(text ?? "");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
