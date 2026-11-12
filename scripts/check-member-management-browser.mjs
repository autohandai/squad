import assert from 'node:assert/strict';
import { createBridgeClient, createTools } from '../server/control-plane/runtime.mjs';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
const bridge = await startBridge({ development: false, prepare: prepareModelRoutingFixture });
let browser;
try {
  const tools = createTools(createBridgeClient(bridge.origin));
  const member = await tools.create_member({ request_id: 'browser-specialist', name: 'Tatiana', role: 'Software engineer', responsibilities: 'Own CLI interoperability.', memories: ['Use versioned MCP contracts.'] });
  browser = await startBrowser();
  await browser.navigate(bridge.origin + '/settings/backups');
  await until(() => browser.evaluate("document.body.innerText.includes('Members to include') && document.body.innerText.includes('Tatiana')"), 'MCP-created member appears in the actual owned app', 30000);
  const updated = await tools.update_member_profile({ member_id: member.id, name: 'Tatiana Smith' });
  assert.equal(updated.name, 'Tatiana Smith');
  await until(() => browser.evaluate("document.body.innerText.includes('Tatiana Smith')"), 'saved MCP rename reaches the open app', 15000);
  await bridge.restart();
  await browser.send('Page.reload');
  await until(() => browser.evaluate("!document.getElementById('boot') && document.body.innerText.includes('Tatiana Smith')"), 'MCP-created member survives server/browser restart', 30000);
  const selected = createTools(createBridgeClient(bridge.origin));
  const saved = await selected.get_member_profile({ member_id: member.id });
  assert.equal(saved.memories[0].text, 'Use versioned MCP contracts.');
  assert.equal(saved.responsibilities, 'Own CLI interoperability.');
  console.log('PASS: real operator creation, ordinary app projection, live rename, restart persistence and exact profile memories.');
} finally { await browser?.close(); await bridge.close(); }
