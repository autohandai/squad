// Regenerates the README screenshots in docs/assets/readme/ from a disposable
// fixture bridge: an isolated state directory, a stub identity server, fixture
// engines and invented members. No real account, folder, email or token can
// appear; it never touches an installed Squad on 127.0.0.1:19821.
//
//   node scripts/capture-readme-screenshots.mjs            # every image
//   node scripts/capture-readme-screenshots.mjs squad chat # only these
//
// Needs Chrome (or CHROME_PATH) and cwebp for compression (brew install webp).
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startBridge, startBrowser, until, delay } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const OUT = 'docs/assets/readme';
const RAW = '.codex-artifacts/readme-screenshots';
const only = new Set(process.argv.slice(2));
const want = name => !only.size || only.has(name);

// Engines the bridge detects as installed and signed in, answering with
// believable model names. Nothing is sent to a provider.
async function prepareEngines(directory) {
  const bin = join(directory, 'bin'), codexHome = join(directory, 'codex'), claudeHome = join(directory, 'claude');
  for (const path of [bin, codexHome, claudeHome, join(directory, 'autohand', 'model-catalog')]) await mkdir(path, { recursive: true });
  await writeFile(join(codexHome, 'auth.json'), '{"fixture":true}');
  await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5.5-codex"\nmodel_reasoning_effort = "medium"\n');
  await writeFile(join(claudeHome, '.credentials.json'), '{"fixture":true}');
  await writeFile(join(directory, 'autohand', 'model-catalog', 'models.json'), JSON.stringify({ autohandai: { moa: { id: 'moa', name: 'Moa (Thinking)' }, fantail: { id: 'fantail', name: 'Fantail' } } }));
  const executable = async (name, body) => { const path = join(bin, name); await writeFile(path, `#!${process.execPath}\n${body}`); await chmod(path, 0o700); };
  await executable('autohand', `const args=process.argv.slice(2);if(args.includes('--version')){console.log('0.9.11');process.exit();}if(args.includes('--help')){console.log('--no-idle-logout --path --config --model --thinking --auto-mode --goal --prompt --dry-run');process.exit();}console.log('Done.');`);
  await executable('codex', `const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex 0.162.1');process.exit();}if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit();}
    if(args[0]==='app-server'){require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);if(p.id===undefined)return;const result=p.method==='model/list'?{data:[{id:'gpt-5.5-codex',model:'gpt-5.5-codex',displayName:'GPT-5.5 Codex',hidden:false,isDefault:true},{id:'gpt-5.5',model:'gpt-5.5',displayName:'GPT-5.5',hidden:false}],nextCursor:null}:{};console.log(JSON.stringify({id:p.id,result}));});}
    else{console.log(JSON.stringify({type:'thread.started',thread_id:'t'}));console.log(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:'Done.'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));}`);
  await executable('claude', `const args=process.argv.slice(2);if(args[0]==='--version'){console.log('2.1.296 (Claude Code)');process.exit();}if(args[0]==='--help'){console.log('--model <model> use alias (opus, sonnet, haiku)\\n--effort <level> choices: low, medium, high');process.exit();}
    if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'team@example.com'}));process.exit();}
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);if(p.type==='control_request')console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:p.request_id,response:{models:[{value:'sonnet',displayName:'Sonnet',description:'Everyday work'},{value:'opus',displayName:'Opus',description:'Hardest problems'}],commands:[],agents:[],account:{}}}}));});`);
  return { PATH: `${bin}:${process.env.PATH}`, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, AUTOHAND_SQUAD_AUTOHAND_BIN: join(bin, 'autohand'), AUTOHAND_ACP_REGISTRY_URL: 'http://127.0.0.1:1/' };
}

const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000).toISOString();

const bridge = await startBridge({ prepare: prepareEngines });
let browser;
try {
  // An invented project folder. Squad only accepts folders inside the home
  // directory, so it lives in the ignored artifacts folder of this checkout.
  const project = resolve(RAW, 'storefront');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'package.json'), '{"name":"storefront"}');
  const base = { workspace: project, projects: [{ path: project, name: 'storefront' }], permissions: {}, status: 'online', skills: [], memory: [] };
  const members = [
    { ...base, id: 'readme-maya', name: 'Maya', role: 'Chief of Staff', avatar: '/avatars/birds/kiwi.webp', harness: { id: 'autohand' } },
    { ...base, id: 'readme-noah', name: 'Noah', role: 'Frontend Engineer', avatar: '/avatars/birds/tui.webp', harness: { id: 'claude', model: 'sonnet' },
      modelRouting: { fallbacks: [{ harness: { id: 'codex', model: 'gpt-5.5-codex', effort: 'medium' } }, { harness: { id: 'autohand', model: 'moa' } }], allowAgentChanges: false } },
    { ...base, id: 'readme-ana', name: 'Ana', role: 'QA Engineer', avatar: '/avatars/birds/kea.webp', harness: { id: 'codex', model: 'gpt-5.5-codex' } },
    { ...base, id: 'readme-leo', name: 'Leo', role: 'Code Reviewer', avatar: '/avatars/birds/ruru.webp', harness: { id: 'autohand' } },
    { ...base, id: 'readme-priya', name: 'Priya', role: 'Product Designer', avatar: '/avatars/birds/kakapo.webp', harness: { id: 'claude', model: 'opus' } },
    { ...base, id: 'readme-sam', name: 'Sam', role: 'Release Manager', avatar: '/avatars/birds/pukeko.webp', harness: { id: 'autohand' } },
  ];
  const dm = [
    { id: 'm1', role: 'user', body: 'The checkout page flashes the old price for a second after you apply a coupon. Can you find out why?', status: 'complete', createdAt: minutesAgo(32) },
    { id: 'm2', role: 'agent', status: 'complete', createdAt: minutesAgo(31), startedAt: minutesAgo(31), completedAt: minutesAgo(30), durationMs: 48000,
      body: 'Found it. `CartSummary` renders the cached total first and only swaps in the discounted one when the coupon request returns.\n\nI changed it to show a pending state while the coupon is checked, and added a test that applies a coupon and asserts the old price never renders.\n\n- `src/cart/CartSummary.tsx`: pending state while the coupon resolves\n- `src/cart/CartSummary.test.tsx`: new regression test\n\nAll 214 tests pass. Want me to ask Leo to review it?' },
    { id: 'm3', role: 'user', body: 'Yes please, and ask Ana to check it on Safari too.', status: 'complete', createdAt: minutesAgo(29) },
    { id: 'm4', role: 'agent', status: 'complete', createdAt: minutesAgo(28), startedAt: minutesAgo(28), completedAt: minutesAgo(28), durationMs: 6000,
      body: '@Leo can you review the coupon fix in `CartSummary`? @Ana please check the checkout flow on Safari with a 10% coupon.' },
  ];
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members, messages: { 'readme-noah': dm } });

  // A channel with a real back-and-forth between members.
  await bridge.api('/api/channels', 'POST', { id: 'readme-launch', name: 'checkout-launch', visibility: 'public' });
  await bridge.api('/api/channels/readme-launch/members', 'POST', { memberIds: members.map(member => member.id) });
  const say = (id, minutes, body, agentId) => ({ id, channelId: 'readme-launch', role: agentId ? 'agent' : 'user', ...(agentId ? { agentId } : {}), body, status: 'complete', createdAt: minutesAgo(minutes), updatedAt: minutesAgo(minutes) });
  await bridge.api('/api/channels/sync', 'PUT', { messages: [
    say('c1', 55, 'We ship the new checkout on Thursday. What is left?'),
    say('c2', 54, 'Three things: the coupon flicker Noah is fixing, a Safari pass from Ana, and release notes. I have put them on the board and will check in at 3 pm.', 'readme-maya'),
    say('c3', 40, 'Coupon fix is up. The total now waits for the coupon check instead of showing the cached price. @Leo can you review?', 'readme-noah'),
    say('c4', 33, 'Reviewed. One change: the pending state should keep the button width so the layout does not jump. Otherwise good to merge.', 'readme-leo'),
    say('c5', 21, 'Safari 18 and iOS: checkout with and without a coupon, both pass. Screenshots are in the task.', 'readme-ana'),
    say('c6', 12, 'Release notes drafted from the merged changes. I will tag 2.4.0 once Noah pushes the width fix.', 'readme-sam'),
  ] });

  // Show an invented person as the signed-in account.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await real(input, init);
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname !== '/api/runtime' || !response.ok) return response;
      const body = await response.clone().json().catch(() => null);
      if (!body?.data) return response;
      body.data.account = { ...(body.data.account || {}), email: 'alex@example.com', name: 'Alex Morgan', signedIn: true };
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
    };
  })();` });

  const prefs = async ({ theme = 'light', layout = 'full' } = {}) => {
    await browser.navigate(`${bridge.origin}/settings`);
    await until(() => browser.evaluate('document.readyState === "complete"'), 'page load');
    await browser.evaluate(`(() => {
      // Theme, skin and layout are device preferences: unprefixed keys.
      const set = (key, value) => localStorage.setItem(key, value);
      set('autohandSquad.v1.theme', ${JSON.stringify(JSON.stringify({ mode: theme, lightTheme: 'autohand-light', darkTheme: 'autohand-dark' }))});
      set('autohandSquad.v1.layout', ${JSON.stringify(layout)});
    })()`);
  };
  const shoot = async (name, url, ready, { width = 1440, height = 900, act } = {}) => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
    await browser.navigate(bridge.origin + url);
    await until(() => browser.evaluate(ready), `${name} ready`, 30000);
    if (act) await act();
    await delay(1500);
    const png = `${RAW}/${name}.png`;
    await browser.screenshot(png);
    await mkdir(OUT, { recursive: true });
    execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', String(width), '0', png, '-o', `${OUT}/${name}.webp`]);
    console.log(`${OUT}/${name}.webp`);
  };

  const hasText = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
  // The engine chip in the chat header lists the member's fallbacks in order.
  const openEngineMenu = async () => {
    await browser.evaluate(`(() => { const chip = [...document.querySelectorAll("header button, [data-slot=dropdown-menu-trigger]")].find(button => button.textContent.trim().startsWith("Claude Code")); if (!chip) throw new Error("No engine chip in the chat header"); chip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); chip.click(); })()`);
    await until(() => browser.evaluate(`document.body.innerText.includes("GPT-5.5") || document.body.innerText.includes("gpt-5.5")`), "fallbacks listed in the engine menu");
    await until(() => browser.evaluate(`!document.body.innerText.includes("Couldn't list models")`), "fallback model lists loaded", 20000);
  };
  for (const theme of ['light', 'dark']) {
    await prefs({ theme });
    if (want('squad')) await shoot(`squad-${theme}`, '/squad', hasText('Priya'));
    if (want('chat')) await shoot(`member-chat-${theme}`, '/conversations/new?member=readme-noah', hasText('Found it.'));
    if (want('fallbacks')) await shoot(`fallbacks-${theme}`, '/conversations/new?member=readme-noah', hasText('Found it.'), { act: openEngineMenu });
    if (want('channel')) await shoot(`channel-${theme}`, '/channels/readme-launch', hasText('Release notes drafted'));
  }
  await prefs({ theme: 'light' });
  if (want('appearance')) await shoot('appearance-light', '/settings/appearance', hasText('Avatars'));
  await prefs({ theme: 'light', layout: 'minified' });
  if (want('minified')) await shoot('minified-light', '/channels/readme-launch', hasText('Release notes drafted'));
  if (browser.errors.length) console.warn('Page errors:', browser.errors);
} finally {
  await browser?.close();
  await bridge.close();
}
