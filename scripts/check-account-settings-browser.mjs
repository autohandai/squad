import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const artifact = '.codex-artifacts/local-0.1.6/account-settings';
await mkdir(artifact, { recursive: true });
const bridge = await startBridge();
let browser;
const report = [];
const part = process.env.ACCOUNT_CHECK_PART || 'all';
try {
  const member = { ...initialAgents[0], name: 'Alex', workspace: bridge.directory, projects: [{ path: bridge.directory }], skills: [] };
  browser = await startBrowser();
  await browser.send('Emulation.setDeviceMetricsOverride', {width:1170,height:760,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!sessionStorage.getItem('account.seeded')) {
      localStorage.setItem('autohandSquad.v1.agents', ${JSON.stringify(JSON.stringify([member]))});
      localStorage.setItem('autohandSquad.v1.removedAgents', ${JSON.stringify(JSON.stringify(initialAgents.slice(1).map(agent => agent.id)))});
      localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
      sessionStorage.setItem('account.seeded','true');
    }
    document.documentElement.dataset.shell='desktop';
    const original=window.fetch.bind(window);
    window.fetch=async(input,options)=>{
      const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
      if(path==='/api/chat/warm') return new Response('{"success":true,"data":{}}',{headers:{'content-type':'application/json'}});
      if(path==='/api/chat/stream') throw new Error('Provider execution is prohibited in this check');
      return original(input,options);
    };
  ` });
  const route = '/conversations/new?member=' + member.id + '&workspace=' + encodeURIComponent(bridge.directory);
  const ready = () => until(() => browser.evaluate(`!!document.querySelector('textarea') && !!document.querySelector('button[aria-label="Open account menu"]')`), 'chat and account trigger');
  await browser.navigate(bridge.origin + route); await ready();
  const key = async (key, code, vk) => { await browser.send('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode:vk}); await browser.send('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode:vk}); };
  const menuItem = label => browser.evaluate(`(() => {const item=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!item)throw new Error('Missing menu item');const r=item.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const pointerClick = async point => { await browser.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point}); await browser.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point}); };
  for (const [skin, theme] of [['soft','light'],['grut','dark'],['default','light'],['default','dark']]) {
    for (const collapsed of [true,false]) {
      await browser.evaluate(`localStorage.setItem('autohandSquad.v1.skin',${JSON.stringify(skin)});localStorage.setItem('autohandSquad.v1.theme',JSON.stringify({mode:${JSON.stringify(theme)}}));localStorage.setItem('autohandSquad.v1.sidebarCollapsed',${JSON.stringify(String(collapsed))});`);
      await browser.navigate(bridge.origin + route); await ready();
      await browser.fill('textarea', 'Keep this unsent draft.');
      await browser.click('Open account menu');
      await until(() => browser.evaluate(`!!document.querySelector('[role="menu"]')`), 'account menu opens');
      const hits = await browser.evaluate(`(() => {const menu=document.querySelector('[role="menu"]');const r=menu.getBoundingClientRect();return {bounds:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight},rows:[...menu.querySelectorAll('[role="menuitem"]')].filter(item=>!item.disabled&&!item.hasAttribute('data-disabled')).map(item=>{const r=item.getBoundingClientRect();return {label:item.textContent.trim(),hits:[.1,.5,.9].map(f=>{const hit=document.elementFromPoint(r.left+r.width*f,r.top+r.height/2);return {inside:item.contains(hit),hit:hit?.textContent?.slice(0,70),tag:hit?.tagName,className:hit?.className};})};})};})()`);
      report.push({skin,theme,collapsed,...hits});
      await writeFile(artifact + '/hit-test.json', JSON.stringify(report,null,2));
      await browser.screenshot(`${artifact}/menu-${skin}-${theme}-${collapsed?'rail':'sidebar'}.png`);
      if (part !== 'settings') {
        assert.ok(hits.rows.every(row => row.hits.every(hit=>hit.inside)), `${skin} ${theme} ${collapsed?'rail':'sidebar'}: every enabled menu row must receive pointer clicks; ${JSON.stringify(hits.rows.filter(row=>row.hits.some(hit=>!hit.inside)))}`);
        assert.ok(hits.bounds.left>=0 && hits.bounds.top>=0 && hits.bounds.right<=hits.bounds.width && hits.bounds.bottom<=hits.bounds.height, 'The account menu stays within the viewport');
      }
      if (part === 'settings') await browser.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim()==='Settings').click()`);
      else await pointerClick(await menuItem('Settings'));
      await until(() => browser.evaluate(`location.pathname==='/settings'`), 'Settings selected');
      assert.ok(await browser.evaluate(`!!document.querySelector('button[aria-label="Back from Settings"]')`), 'Settings provides an explicit way back');
      await browser.click('Back from Settings'); await ready();
      assert.equal(await browser.evaluate(`location.pathname+location.search`), route, 'Return to the exact origin including its selected workspace and panel');
      assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Keep this unsent draft.');
      await browser.click('Open account menu'); await key('Escape','Escape',27);
      await until(() => browser.evaluate(`!document.querySelector('[role="menu"]')`), 'Escape dismisses the menu');
      assert.equal(await browser.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Open account menu', 'Escape restores focus to the gear');
      console.log(`PASS ${skin} ${theme} ${collapsed?'rail':'sidebar'}: pointer targets, bounds, Settings return and draft preservation.`);
    }
  }
  // A Settings section/hash and a reload must not replace the originating screen.
  await browser.evaluate(`window.dispatchEvent(new CustomEvent('autohand-squad:menu',{detail:{action:'settings'}}))`);
  await until(() => browser.evaluate(`location.pathname==='/settings'`), 'native settings action');
  await browser.evaluate(`location.hash='settings-chat'`);
  await browser.navigate(bridge.origin + '/settings#settings-chat');
  await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Back from Settings"]')`), 'reopened Settings');
  await browser.click('Back from Settings'); await ready();
  assert.equal(await browser.evaluate(`location.pathname+location.search`), route);
  assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Keep this unsent draft.');
  // Keyboard opening, roving focus and selection use the same menu behavior.
  await browser.evaluate(`document.querySelector('button[aria-label="Open account menu"]').focus()`);
  await key('ArrowDown','ArrowDown',40);
  await until(() => browser.evaluate(`document.activeElement?.getAttribute('role')==='menuitem'`), 'keyboard focuses first action');
  await key('Home','Home',36); await key('ArrowDown','ArrowDown',40); await key('Enter','Enter',13);
  await until(() => browser.evaluate(`location.pathname==='/settings'`), 'keyboard Settings selection');
  await browser.click('Back from Settings'); await ready();
  assert.deepEqual(browser.errors, []);
  console.log('PASS native Settings entry, section/reload return, keyboard selection and Escape focus; no provider invoked.');
} finally { await browser?.close(); await bridge.close(); }
