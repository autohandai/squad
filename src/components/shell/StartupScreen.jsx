import { birdFaceSvg } from "@/lib/bird-faces";
import { pickFlock } from "@/lib/flock";

// The one startup surface (ADR-0288). index.html paints it before the bundle;
// this renders the same classes (styled inline in index.html) so the handover
// from the static page, through ownership, to the bridge answering changes
// only the status line. The native shell's loading page draws the same.

const [lead, ...others] = pickFlock(3, { seed: "boot" });
// The order vite.config.js draws into index.html: the lead in the middle.
const BIRDS = [others[0], lead, others[1]].filter(Boolean).map(birdFaceSvg);

/** The saved theme mode, as index.html reads it before anything loads. */
export function startupMode() {
  try {
    const mode = JSON.parse(localStorage.getItem("autohandSquad.v1.theme") || "{}").mode;
    if (mode === "light" || mode === "dark") return mode;
  } catch {
    // Unreadable storage: follow the system, like the static page.
  }
  return "";
}

function markFor(mode) {
  const light = mode ? mode === "light" : typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  return light ? "/brand/autohand-squad/autohand-squad-mark-light.webp" : "/brand/autohand-squad/autohand-squad-mark-dark.webp";
}

/** The menu-bar popover attaches to a running Squad: one line, as index.html draws it. */
function isQuickChat() {
  return typeof location !== "undefined" && location.pathname === "/quick-chat";
}

/**
 * status   the one line that changes as Squad starts
 * tone     "alert" for a problem, which is then read out at once
 * mode     "light" | "dark"; defaults to the saved mode, else the system
 * compact  the popover's one-line form (no mark, name or birds)
 * children actions under the line (Retry, Sign out); buttons styled by .boot-actions
 */
export function StartupScreen({ status, tone, mode = startupMode(), compact = isQuickChat(), children = null }) {
  return (
    <div className="boot-surface" data-startup data-settled data-compact={compact || undefined} data-mode={mode || undefined}>
      {compact ? null : <>
        <img className="boot-mark" src={markFor(mode)} alt="" width="56" height="56" decoding="async" />
        <p className="boot-name">Autohand Squad</p>
        <div className="boot-flock" aria-hidden="true">
          {BIRDS.map((svg, index) => <span key={index} dangerouslySetInnerHTML={{ __html: svg }} />)}
        </div>
      </>}
      <p className="boot-status" data-tone={tone || undefined} role={tone === "alert" ? "alert" : "status"} aria-live={tone === "alert" ? "assertive" : "polite"}>{status}</p>
      {children ? <div className="boot-actions">{children}</div> : null}
    </div>
  );
}
