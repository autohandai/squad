// Skins: the whole look, not just the palette (ADR-0058).
//
// The existing theme presets swap the 23 colour tokens and nothing else, which
// is why every preset still looks like the same product. A skin also sets the
// corner radius, how surfaces are raised, how tight the spacing is, and where
// member avatars come from - the four things that actually make two chat apps
// look like different software.
//
// A skin that declares no tokens keeps whatever theme preset the user picked,
// so the default skin leaves the preset system exactly as it was.

import { blobForMember } from "./blob-avatar.js";

export const DEFAULT_SKIN_ID = "default";

/** Every var a skin may set beyond the colour tokens, with its default. */
export const SKIN_VAR_DEFAULTS = {
  radius: "0.625rem",
  "skin-elevation": "none",
  "skin-elevation-strong": "none",
  "skin-density": "1",
  "skin-avatar-radius": "0.375rem",
};

export const SKINS = [
  {
    id: "default",
    label: "Autohand",
    description: "Today's console. Calm, neutral and direct, in whichever theme you picked.",
    // No surface and no tokens: the user's own light/dark choice and theme
    // preset survive switching back to this skin.
    surface: null,
    tokens: null,
    vars: {
      radius: "0.625rem",
      "skin-elevation": "none",
      "skin-elevation-strong": "none",
      "skin-density": "1",
      "skin-avatar-radius": "0.375rem",
    },
    avatars: "photo",
    swatches: ["#0a0a0a", "#fafafa", "#5ed46f", "#27272a"],
  },
  {
    id: "soft",
    label: "Soft",
    description: "Light and rounded, panels that float. Coral is the only colour that asks for anything.",
    surface: "light",
    tokens: {
      background: "#eceef4",
      foreground: "#1d2330",
      card: "#f7f8fb",
      "card-foreground": "#1d2330",
      popover: "#ffffff",
      "popover-foreground": "#1d2330",
      primary: "#ef7a5c",
      "primary-foreground": "#ffffff",
      secondary: "#e4e7ef",
      "secondary-foreground": "#3c4456",
      muted: "#e7eaf1",
      "muted-foreground": "#77809a",
      accent: "#dfe3ee",
      "accent-foreground": "#2a3142",
      destructive: "#d9534f",
      border: "#dce0ea",
      input: "#dce0ea",
      ring: "#ef7a5c",
      "chart-1": "#ef7a5c",
      "chart-2": "#7aa2d8",
      "chart-3": "#6fc3a0",
      "chart-4": "#e8b45c",
      "chart-5": "#9b8ed6",
    },
    vars: {
      radius: "1.25rem",
      "skin-elevation": "0 1px 2px rgba(29, 35, 48, 0.04), 0 8px 24px rgba(29, 35, 48, 0.06)",
      "skin-elevation-strong": "0 2px 4px rgba(29, 35, 48, 0.05), 0 18px 48px rgba(29, 35, 48, 0.10)",
      // Density stays at 1. Scaling the root to 18.4px cost the page a
      // scrollbar and started to disagree with the fixed-pixel icon sizes;
      // the float reads from radius and shadow, not from bigger type.
      "skin-density": "1",
      "skin-avatar-radius": "9999px",
    },
    avatars: "portrait",
    swatches: ["#eceef4", "#ef7a5c", "#f7f8fb", "#1d2330"],
  },
  {
    id: "grut",
    label: "Grut",
    description: "Flat, quiet and dark. Every member is a blob with a face.",
    surface: "dark",
    tokens: {
      background: "#0d0d0f",
      foreground: "#ededf0",
      card: "#151517",
      "card-foreground": "#ededf0",
      popover: "#1a1a1d",
      "popover-foreground": "#ededf0",
      primary: "#ededf0",
      "primary-foreground": "#0d0d0f",
      secondary: "#1f1f23",
      "secondary-foreground": "#c9c9d1",
      muted: "#1c1c20",
      "muted-foreground": "#86868f",
      accent: "#232328",
      "accent-foreground": "#ededf0",
      destructive: "#e5544b",
      border: "#26262b",
      input: "#26262b",
      ring: "#4d8df0",
      "chart-1": "#4d8df0",
      "chart-2": "#5bc4a4",
      "chart-3": "#f0a23c",
      "chart-4": "#a97bf0",
      "chart-5": "#ef6a8c",
    },
    vars: {
      radius: "0.75rem",
      "skin-elevation": "none",
      "skin-elevation-strong": "none",
      "skin-density": "0.95",
      "skin-avatar-radius": "9999px",
    },
    avatars: "blob",
    swatches: ["#0d0d0f", "#4d8df0", "#5bc4a4", "#f0a23c"],
  },
];

const BY_ID = new Map(SKINS.map((skin) => [skin.id, skin]));

export function skinById(id) {
  return BY_ID.get(String(id || "")) || BY_ID.get(DEFAULT_SKIN_ID);
}

export function isSkinId(id) {
  return BY_ID.has(String(id || ""));
}

/**
 * The surface a skin forces, or the user's own choice when it forces none.
 * Only the default skin follows the user; a skin whose whole point is being
 * light has nothing sensible to show in the dark.
 */
export function surfaceForSkin(skin, userSurface) {
  return skin?.surface || userSurface;
}

// ---------------------------------------------------------------------------
// Where a member's face comes from

/**
 * Roles that actually have soft-skin artwork in `public/avatars/soft/`.
 *
 * Radix unmounts an AvatarImage when it fails to load, so an `onError`
 * handler cannot quietly swap in a fallback - a missing portrait becomes an
 * initial, not a photo. Listing what exists keeps the skin pointing only at
 * files that are there; `check-skins` fails if an entry has no file.
 */
export const SOFT_PORTRAIT_SLUGS = [
  "ai-engineer",
  "backend-engineer",
  "common-qa-engineer",
  "content-operations-specialist",
  "data-analyst",
  "devops-engineer",
  "frontend-developer",
  "full-stack-developer",
  "mobile-developer",
  "platform-engineer",
  "product-manager",
  "scrum-master",
  "security-engineer",
  "solution-architect",
  "technical-writer",
  "ux-ui-designer",
];

/** The role slug a member's artwork is filed under. */
export function roleSlug(member) {
  return String(member?.employeeType || "").trim().toLowerCase();
}

/**
 * What to draw for this member under this skin: an image to load, or a blob to
 * render. Kept here rather than in the avatar component so the fallbacks are
 * checkable without a browser - a custom role has no portrait on disk, and
 * falling through to the member's own picture is better than an empty circle.
 */
export function memberAvatar(member, skin) {
  const kind = skin?.avatars || "photo";
  if (kind === "blob") {
    return { kind: "blob", blob: blobForMember(member) };
  }
  if (kind === "portrait") {
    const slug = roleSlug(member);
    if (slug && SOFT_PORTRAIT_SLUGS.includes(slug)) {
      return { kind: "image", src: `/avatars/soft/${slug}.jpg`, fallbackSrc: member?.avatar || "" };
    }
    // No portrait drawn for this role yet: the member's own picture is a
    // better answer than an empty circle.
    return { kind: "image", src: member?.avatar || "", fallbackSrc: "" };
  }
  return { kind: "image", src: member?.avatar || "", fallbackSrc: "" };
}
