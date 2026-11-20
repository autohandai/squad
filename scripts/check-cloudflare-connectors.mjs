#!/usr/bin/env node
// Cloudflare's official MCP servers in the connector catalogue (ADR-0270),
// against a real isolated bridge and Cloudflare's live servers: the catalogue
// lists them with the account-wide server first, and installing it registers
// Squad with Cloudflare (MCP OAuth, dynamic registration, PKCE) and returns
// Cloudflare's sign-in page. No Cloudflare account is signed in to.
import assert from 'node:assert/strict';
import { startBridge } from './lib/reliability-browser.mjs';

const bridge = await startBridge();
try {
  const catalog = await bridge.api('/api/connectors/catalog?search=cloudflare');
  assert.equal(catalog.success, true, JSON.stringify(catalog));
  const rows = catalog.data.items.filter((item) => item.squad && item.logo === 'cloudflare');
  assert.deepEqual(rows.map((row) => row.catalogId).slice(0, 2), ['cloudflare', 'cloudflare-observability'], 'the account-wide server first');
  assert.equal(rows.length, 7);
  assert.equal(rows[0].options[0].label, 'Sign in with Cloudflare');
  assert.equal(rows.find((row) => row.catalogId === 'cloudflare-docs').options[0].label, 'Hosted by Cloudflare');

  const installed = await bridge.api('/api/connectors/install', 'POST', { catalogId: 'cloudflare', option: 'cloudflare' }, 60000);
  assert.equal(installed.success, true, JSON.stringify(installed).slice(0, 400));
  const { connector, signIn, signInError } = installed.data;
  assert.equal(connector.name, 'Cloudflare'); assert.equal(connector.url, 'https://mcp.cloudflare.com/mcp');
  assert.ok(connector.oauth, 'the connector needs a Cloudflare sign-in');
  assert.ok(!signInError, `sign-in starts: ${signInError}`);
  const page = new URL(signIn?.url || signIn?.authorizationUrl || '');
  assert.equal(page.hostname, 'mcp.cloudflare.com', `Cloudflare's own sign-in page: ${page}`);
  assert.equal(page.searchParams.get('code_challenge_method'), 'S256', 'PKCE');
  assert.ok(page.searchParams.get('client_id'), 'a client registered with Cloudflare, not one of ours');
  const listed = (await bridge.api('/api/connectors/catalog?search=cloudflare')).data.items.find((item) => item.catalogId === 'cloudflare');
  assert.equal(listed.installed, true, 'the catalogue shows it added');
  console.log(`PASS cloudflare connectors: 7 official servers listed, account-wide first; installing it registers with Cloudflare and opens ${page.origin}${page.pathname} with PKCE.`);
} finally { await bridge.close(); }
