#!/usr/bin/env node
// Writes CONNECTOR_CLIENTS.json into a runtime directory from the build
// environment (ADR-0248). Only the three installed-app client values are
// read; a malformed value fails the build instead of shipping a broken
// sign-in. Values are never printed.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTOR_CLIENTS_FILE, connectorClientsFrom } from '../server/connectors/build-clients.mjs';

const KEYS = ['AUTOHAND_SQUAD_GOOGLE_CLIENT_ID', 'AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET', 'AUTOHAND_SQUAD_GITHUB_CLIENT_ID'];

// A local packaged build may keep the values in the checkout's .env, as
// product telemetry does; the process environment wins per key.
async function localEnv(envFile) {
  const local = {};
  if (!envFile) return local;
  try {
    const lines = (await readFile(envFile, 'utf8')).split(/\r?\n/);
    for (const key of KEYS) {
      const line = lines.find((value) => value.startsWith(`${key}=`));
      if (line) local[key] = line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* No .env: only the process environment counts. */ }
  return local;
}

export async function stageConnectorClients({ runtimeDir, env = process.env, envFile = null, log = console.log }) {
  const local = await localEnv(envFile);
  const merged = Object.fromEntries(KEYS.map((key) => [key, String(env[key] || '').trim() || local[key] || '']));
  const { google, github } = connectorClientsFrom(merged);
  const staged = {};
  if (google) staged.google = google.clientSecret ? google : { clientId: google.clientId };
  if (github) staged.github = github;
  await writeFile(join(runtimeDir, CONNECTOR_CLIENTS_FILE), `${JSON.stringify(staged, null, 2)}\n`);
  log(`Connector sign-in clients: Google ${google ? 'staged' : 'not set'}, GitHub ${github ? 'staged' : 'not set'}.`);
  return { google: Boolean(google), github: Boolean(github) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtimeDir = process.argv[2];
  if (!runtimeDir) { console.error('Usage: stage-connector-clients.mjs <runtime-dir>'); process.exit(64); }
  try { await stageConnectorClients({ runtimeDir: resolve(runtimeDir) }); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
