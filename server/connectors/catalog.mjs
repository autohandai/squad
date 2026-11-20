// The curated part of the connector catalogue (ADR-0244): the services shown
// before anyone searches, in plain words, with their brand marks, plus Squad's
// own Gmail, Google Drive and Google Calendar connectors. Everything else
// comes from the official MCP Registry (registry.mjs). A featured entry names
// its registry server; the registry stays the source of how it installs.

export const FEATURED = [
  { id: 'composio', registryName: 'io.github.ComposioHQ/composio', title: 'Composio', logo: '', website: 'https://composio.dev', description: 'Gmail, Slack, HubSpot and about 1,000 more apps through one Composio sign-in. Composio holds the app connections.' },
  { id: 'github', registryName: 'io.github.github/github-mcp-server', title: 'GitHub', logo: 'github', website: 'https://github.com', description: 'Repositories, issues, pull requests and Actions.' },
  { id: 'linear', registryName: 'app.linear/linear', title: 'Linear', logo: 'linear', website: 'https://linear.app', description: 'Find, create and update issues, projects and comments.' },
  { id: 'notion', registryName: 'com.notion/mcp', title: 'Notion', logo: 'notion', website: 'https://notion.so', description: 'Search, read and edit pages and databases in your workspace.' },
  { id: 'figma', registryName: 'com.figma.mcp/mcp', title: 'Figma', logo: 'figma', website: 'https://figma.com', description: 'Read designs, components and variables from Figma files.' },
  { id: 'stripe', registryName: 'com.stripe/mcp', title: 'Stripe', logo: 'stripe', website: 'https://stripe.com', description: 'Customers, payments, invoices and Stripe documentation.' },
  { id: 'vercel', registryName: 'com.vercel/vercel-mcp', title: 'Vercel', logo: 'vercel', website: 'https://vercel.com', description: 'Projects, deployments and their logs.' },
  { id: 'supabase', registryName: 'com.supabase/mcp', title: 'Supabase', logo: 'supabase', website: 'https://supabase.com', description: 'Databases, tables, migrations and edge functions.' },
  { id: 'cloudflare', registryName: 'com.cloudflare.mcp/mcp', title: 'Cloudflare', logo: 'cloudflare', website: 'https://cloudflare.com', description: 'Cloudflare documentation and developer platform reference.' },
  { id: 'atlassian', registryName: 'com.atlassian/atlassian-mcp-server', title: 'Atlassian', logo: 'atlassian', website: 'https://atlassian.com', description: 'Jira issues and Confluence pages through Atlassian Rovo.' },
  { id: 'context7', registryName: 'io.github.upstash/context7', title: 'Context7', logo: '', website: 'https://context7.com', description: 'Current library documentation and code examples.' },
  { id: 'playwright', registryName: 'io.github.microsoft/playwright-mcp', title: 'Playwright', logo: '', website: 'https://playwright.dev', description: 'Drive a browser: open pages, click, type and read them.' },
];

/**
 * Squad's own Google connectors. Each installs Squad's Google server for one
 * product (`google-workspace-mcp.mjs`), signed in with a Google OAuth client
 * the person provides, or goes through Composio's hosted sign-in instead.
 */
export const GOOGLE_ENTRIES = [
  { id: 'gmail', product: 'gmail', title: 'Gmail', logo: 'gmail', website: 'https://mail.google.com', description: 'Search and read mail, write drafts and send.', tools: ['gmail_search', 'gmail_read', 'gmail_create_draft', 'gmail_send'] },
  { id: 'google-drive', product: 'drive', title: 'Google Drive', logo: 'googledrive', website: 'https://drive.google.com', description: 'Search Drive and read Docs, Sheets, Slides and text files.', tools: ['drive_search', 'drive_recent', 'drive_read'] },
  { id: 'google-calendar', product: 'calendar', title: 'Google Calendar', logo: 'googlecalendar', website: 'https://calendar.google.com', description: 'See upcoming events and add new ones.', tools: ['calendar_list_events', 'calendar_create_event'] },
];

export const COMPOSIO_REGISTRY_NAME = 'io.github.ComposioHQ/composio';

/**
 * Cloudflare's official MCP servers (ADR-0270), hosted by Cloudflare. Each
 * signs in with the person's own Cloudflare account through MCP OAuth with
 * dynamic client registration and PKCE (checked 20 Nov 2026: every one but
 * the docs answers 401 with resource metadata and offers /register), so
 * Squad needs no client id of its own. The account-wide server comes first.
 */
export const CLOUDFLARE_ENTRIES = [
  { id: 'cloudflare', title: 'Cloudflare', url: 'https://mcp.cloudflare.com/mcp', description: 'Your Cloudflare account through Cloudflare’s own API: Workers, DNS, zones, R2, D1, KV and more. Sign in with Cloudflare.' },
  { id: 'cloudflare-observability', title: 'Cloudflare Observability', url: 'https://observability.mcp.cloudflare.com/mcp', description: 'Logs and analytics for your Workers, to find what broke and why.' },
  { id: 'cloudflare-bindings', title: 'Cloudflare Workers Bindings', url: 'https://bindings.mcp.cloudflare.com/mcp', description: 'Build on Workers with storage, AI and compute: KV, R2, D1, Hyperdrive and Workers AI.' },
  { id: 'cloudflare-builds', title: 'Cloudflare Workers Builds', url: 'https://builds.mcp.cloudflare.com/mcp', description: 'See and debug your Workers builds.' },
  { id: 'cloudflare-dns-analytics', title: 'Cloudflare DNS Analytics', url: 'https://dns-analytics.mcp.cloudflare.com/mcp', description: 'DNS performance and settings for your zones.' },
  { id: 'cloudflare-radar', title: 'Cloudflare Radar', url: 'https://radar.mcp.cloudflare.com/mcp', description: 'Internet traffic, outages and URL scans from Cloudflare Radar.' },
  { id: 'cloudflare-docs', title: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', description: 'Search Cloudflare’s documentation. No sign-in, and no access to your account.', noSignIn: true },
];

export function cloudflareEntry(catalogId) {
  return CLOUDFLARE_ENTRIES.find((entry) => entry.id === catalogId) || null;
}

/** A Cloudflare entry as a catalogue row, in the same shape as registry rows. */
export function cloudflareListing(entry, { installed = [] } = {}) {
  const match = installed.find((item) => item.kind === 'url' && String(item.url || '').replace(/\/+$/, '') === entry.url);
  return {
    name: `squad/${entry.id}`,
    catalogId: entry.id,
    title: entry.title,
    description: entry.description,
    version: '',
    website: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
    logo: 'cloudflare',
    icon: '',
    iconDark: '',
    featured: true,
    squad: true,
    installed: Boolean(match),
    installedId: match?.id || '',
    tools: [],
    options: [
      { id: 'cloudflare', kind: 'remote', label: entry.noSignIn ? 'Hosted by Cloudflare' : 'Sign in with Cloudflare', detail: entry.url, runs: 'hosted', transport: 'http', available: true, needs: '', inputs: [] },
    ],
  };
}

/** A Google entry as a catalogue row, in the same shape as registry rows. */
export function googleListing(entry, { installed = [], googleClientReady = false } = {}) {
  const match = installed.find((item) => item.kind === 'google' && item.google?.product === entry.product);
  const composio = installed.find((item) => item.registry?.name === COMPOSIO_REGISTRY_NAME);
  return {
    name: `squad/${entry.id}`,
    catalogId: entry.id,
    title: entry.title,
    description: entry.description,
    version: '',
    website: entry.website,
    logo: entry.logo,
    icon: '',
    iconDark: '',
    featured: true,
    squad: true,
    installed: Boolean(match),
    installedId: match?.id || '',
    tools: entry.tools,
    options: [
      { id: 'google', kind: 'google', label: 'Squad connector', detail: 'Runs on this computer and signs in to Google directly.', runs: 'local', available: true, needs: googleClientReady ? '' : 'Google OAuth client', inputs: [], signIn: 'google' },
      { id: 'composio', kind: 'composio', label: 'Through Composio', detail: composio ? 'Uses your Composio connector; connect this app in Composio when a member first asks.' : 'Adds Composio and signs in there; Composio connects your Google account.', runs: 'hosted', available: true, needs: '', inputs: [], signIn: 'oauth' },
    ],
  };
}

export function googleEntry(catalogId) {
  return GOOGLE_ENTRIES.find((entry) => entry.id === catalogId) || null;
}

export function featuredEntry(registryName) {
  return FEATURED.find((entry) => entry.registryName === registryName) || null;
}
