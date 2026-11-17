#!/usr/bin/env node
// Refresh server/connectors/catalog-snapshot.json: the featured connectors'
// registry entries as of today, so the catalogue opens instantly and works
// offline before the live registry answers (ADR-0244). Read-only against the
// public MCP Registry; run it when the featured list changes or before a
// release, and commit the result.
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FEATURED } from '../server/connectors/catalog.mjs';
import { DEFAULT_REGISTRY_URL, sanitizeServer } from '../server/connectors/registry.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const base = process.env.AUTOHAND_SQUAD_MCP_REGISTRY_URL || DEFAULT_REGISTRY_URL;
const servers = [];
for (const entry of FEATURED) {
  try {
    // The raw entry, so the bundled copy is read by the same checks as a live one.
    const response = await fetch(`${base}/${encodeURIComponent(entry.registryName)}/versions/latest`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const server = (await response.json()).server;
    if (!sanitizeServer(server)) throw new Error('not a usable registry entry');
    servers.push(server);
    console.log(`${entry.registryName} ${server.version}`);
  } catch (error) {
    console.error(`${entry.registryName}: ${error.message}`);
    process.exitCode = 1;
  }
}
const file = join(root, 'server', 'connectors', 'catalog-snapshot.json');
await writeFile(file, `${JSON.stringify({ takenAt: new Date().toISOString().slice(0, 10), source: 'https://registry.modelcontextprotocol.io/v0/servers', servers }, null, 2)}\n`);
console.log(`wrote ${servers.length} servers to ${file}`);
