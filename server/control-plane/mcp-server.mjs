#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_BRIDGE_URL, SERVER_NAME, TOOLS, parseBridgeUrl } from './control-plane.mjs';
import { createBridgeClient, createTools, createRpcHandler, serveStdio } from './runtime.mjs';
export { createBridgeClient, createTools, createRpcHandler, serveStdio } from './runtime.mjs';

function readBridgeArgument(argv) {
  const index = argv.indexOf('--bridge');
  if (index >= 0) return argv[index + 1] || '';
  const inline = argv.find((argument) => argument.startsWith('--bridge='));
  if (inline) return inline.slice('--bridge='.length);
  return process.env.AUTOHAND_SQUAD_BRIDGE_URL || DEFAULT_BRIDGE_URL;
}

async function main() {
  let origin;
  try { origin = parseBridgeUrl(readBridgeArgument(process.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
  const bridge = createBridgeClient(origin);
  const tools = createTools(bridge);
  const handle = createRpcHandler(tools, { bridgeUrl: origin });
  process.stderr.write(`${SERVER_NAME}: bridge ${origin}; tools ${TOOLS.map((tool) => tool.name).join(', ')}\n`);
  await serveStdio({ handle });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error?.stack || error}\n`); process.exit(1); });
}
