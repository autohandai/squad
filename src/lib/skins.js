// A skin owns typography, geometry, density and faces as well as colours.
// Mode always chooses light/dark; only Autohand uses theme presets (ADR-0146).
import { blobForMember } from './blob-avatar.js';
import { SKIN_PALETTES } from './skin-palettes.js';

export const DEFAULT_SKIN_ID = 'default';
export const SKIN_VAR_DEFAULTS = {
  radius: '0.5rem',
  'skin-elevation': 'none',
  'skin-elevation-strong': 'none',
  'skin-density': '1',
  'skin-avatar-radius': '0.375rem',
  // A panel's corner answers to the window mask, independently of controls.
  'skin-panel-radius': '0px',
  'font-ui': '"Autohand Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'skin-heading-font': 'var(--font-ui)',
  'skin-font-stretch': '100%',
};

function skin({ id, vars = {}, ...design }) {
  return { id, ...design, tokens: SKIN_PALETTES[id] || null, vars: { ...SKIN_VAR_DEFAULTS, ...vars } };
}

export const SKINS = [
  skin({ id: 'default', label: 'Autohand',
    description: 'Calm, neutral and direct. Make it yours with theme presets.',
    avatars: 'photo', swatches: ['#0a0a0a', '#fafafa', '#5ed46f', '#27272a'] }),
  skin({ id: 'soft', label: 'Soft',
    description: 'Quiet floating panels, round portraits and a coral accent.',
    vars: { radius: '1.25rem', 'skin-avatar-radius': '9999px', 'skin-panel-radius': '8px',
      // At a 4px inset, a broad shadow fills the gap and reads as a bevel.
      'skin-elevation': '0 1px 2px rgba(29, 35, 48, 0.05)',
      'skin-elevation-strong': '0 2px 4px rgba(29, 35, 48, 0.05), 0 18px 48px rgba(29, 35, 48, 0.10)' },
    avatars: 'portrait', swatches: ['#eceef4', '#ef7a5c', '#252b3a', '#1d2330'] }),
  skin({ id: 'grut', label: 'Grut',
    description: 'Flat and quiet, in light or dark. Every member is a blob with a face.',
    vars: { radius: '0.75rem', 'skin-density': '0.95', 'skin-avatar-radius': '9999px' },
    avatars: 'blob', swatches: ['#f7f7f8', '#0d0d0f', '#4d8df0', '#5bc4a4'] }),
  skin({ id: 'paper', label: 'Paper',
    description: 'Warm paper, editorial headings and soft-edged portraits.',
    vars: { radius: '0.375rem', 'skin-density': '1.02', 'skin-avatar-radius': '0.375rem',
      'skin-heading-font': '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' },
    avatars: 'portrait', swatches: ['#faf7ef', '#765137', '#eee5d4', '#201d19'] }),
  skin({ id: 'slate', label: 'Slate',
    description: 'Cool steel, condensed type and a compact, square-cut rhythm.',
    vars: { radius: '0.25rem', 'skin-density': '0.94', 'skin-avatar-radius': '0.125rem', 'skin-font-stretch': '90%' },
    avatars: 'photo', swatches: ['#f2f5f8', '#355c7d', '#95b9d5', '#101922'] }),
  skin({ id: 'grove', label: 'Grove',
    description: 'Sage surfaces, open spacing and round illustrated faces.',
    vars: { radius: '0.5rem', 'skin-density': '1.04', 'skin-avatar-radius': '9999px',
      'skin-elevation-strong': '0 2px 4px rgba(20, 35, 24, 0.06), 0 12px 28px rgba(20, 35, 24, 0.10)' },
    avatars: 'portrait', swatches: ['#f4f6ee', '#426449', '#b1d29f', '#152018'] }),
  skin({ id: 'blueprint', label: 'Blueprint',
    description: 'Drafting blue, monospaced type and crisp, ruled edges.',
    vars: { radius: '0.125rem', 'skin-density': '0.96', 'skin-avatar-radius': '0.125rem',
      'font-ui': '"Autohand Mono", ui-monospace, SFMono-Regular, Menlo, monospace' },
    avatars: 'photo', swatches: ['#f5f8ff', '#2b5cad', '#9fc3ff', '#101c36'] }),
  skin({ id: 'ember', label: 'Ember',
    description: 'Warm ink, rust accents and generous studio spacing.',
    vars: { radius: '0.375rem', 'skin-density': '1.03', 'skin-avatar-radius': '0.375rem',
      'skin-font-stretch': '95%', 'skin-elevation-strong': '0 2px 4px rgba(40, 20, 12, 0.08), 0 12px 28px rgba(40, 20, 12, 0.12)' },
    avatars: 'photo', swatches: ['#fff7ee', '#a14626', '#f4b183', '#251b18'] }),
];

const BY_ID = new Map(SKINS.map(design => [design.id, design]));
export function skinById(id) { return BY_ID.get(String(id || '')) || BY_ID.get(DEFAULT_SKIN_ID); }
export function isSkinId(id) { return BY_ID.has(String(id || '')); }
export function tokensForSkin(design, surface) { return design?.tokens?.[surface] || null; }

// Roles with installed artwork. Custom roles keep their member's own photo.
export const SOFT_PORTRAIT_SLUGS = [
  'ai-engineer', 'backend-engineer', 'common-qa-engineer', 'content-operations-specialist',
  'data-analyst', 'devops-engineer', 'frontend-developer', 'full-stack-developer', 'mobile-developer',
  'platform-engineer', 'product-manager', 'scrum-master', 'security-engineer', 'solution-architect',
  'technical-writer', 'ux-ui-designer',
];
export function roleSlug(member) { return String(member?.employeeType || '').trim().toLowerCase(); }
export function memberAvatar(member, design) {
  if (design?.avatars === 'blob') return { kind: 'blob', blob: blobForMember(member) };
  if (design?.avatars === 'portrait') {
    const role = roleSlug(member);
    if (SOFT_PORTRAIT_SLUGS.includes(role)) return { kind: 'image', src: `/avatars/soft/${role}.jpg`, fallbackSrc: member?.avatar || '' };
  }
  return { kind: 'image', src: member?.avatar || '', fallbackSrc: '' };
}
