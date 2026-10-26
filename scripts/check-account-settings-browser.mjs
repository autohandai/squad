import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { initialAgents } from '../src/data.js';
import { memberFixture } from './lib/member-fixture.mjs';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const artifact = '.codex-artifacts/local-0.1.6/account-settings';
await mkdir(artifact, { recursive: true });
const bridge = await startBridge();
let browser;
const report = [];
const part = process.env.ACCOUNT_CHECK_PART || 'all';
try {
  const member = memberFixture({ name: 'Alex', workspace: bridge.directory, projects: [{ path: bridge.directory }], skills: [] });
  browser = await startBrowser();
  await browser.send('Emulation.setDeviceMetricsOverride', {width:1170,height:760,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.accountDocumentId=crypto.randomUUID();
    if (!sessionStorage.getItem('account.seeded')) {
      localStorage.setItem('autohandSquad.v1.agents', ${JSON.stringify(JSON.stringify([member]))});
      localStorage.setItem('autohandSquad.v1.removedAgents', ${JSON.stringify(JSON.stringify(initialAgents.slice(1).map(agent => agent.id)))});
      localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
      sessionStorage.setItem('account.seeded','true');
    }
    const nativeShell=()=>{document.documentElement.dataset.shell='desktop';document.documentElement.dataset.platform='mac';};
    if(document.documentElement) nativeShell();
    else document.addEventListener('DOMContentLoaded',nativeShell,{once:true});
    const original=window.fetch.bind(window);
    window.fetch=async(input,options)=>{
      const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
      if(path==='/api/chat/warm') return new Response('{"success":true,"data":{}}',{headers:{'content-type':'application/json'}});
      if(path==='/api/chat/stream') throw new Error('Provider execution is prohibited in this check');
      return original(input,options);
    };
  ` });
  const route = '/conversations/new?member=' + member.id + '&workspace=' + encodeURIComponent(bridge.directory);
  const navigateFresh = async path => {
    const previous = await browser.evaluate('window.accountDocumentId');
    await browser.navigate(bridge.origin + path);
    await until(() => browser.evaluate(`typeof window.accountDocumentId==='string' && window.accountDocumentId!==${JSON.stringify(previous || '')} && !document.getElementById('boot')`), 'fresh app document');
  };
  const ready = () => until(() => browser.evaluate(`!!document.querySelector('textarea') && !!document.querySelector('button[aria-label="Open account menu"]')`), 'chat and account trigger');
  await navigateFresh(route); await ready();
  const key = async (key, code, vk) => { await browser.send('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode:vk}); await browser.send('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode:vk}); };
  const menuItem = label => browser.evaluate(`(() => {const item=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!item)throw new Error('Missing menu item');const r=item.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const pointerClick = async point => { await browser.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point}); await browser.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point}); };
  const openMenu = async () => pointerClick(await browser.evaluate(`(() => {const button=[...document.querySelectorAll('button[aria-label="Open account menu"]')].find(item=>item.getBoundingClientRect().width);const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`));
  for (const [skin, theme] of [['soft','light'],['grut','dark'],['default','light'],['default','dark']]) {
    for (const collapsed of [true,false]) {
      await browser.evaluate(`localStorage.setItem('autohandSquad.v1.skin',${JSON.stringify(skin)});localStorage.setItem('autohandSquad.v1.theme',JSON.stringify({mode:${JSON.stringify(theme)}}));localStorage.setItem('autohandSquad.v1.sidebarCollapsed',${JSON.stringify(String(collapsed))});`);
      await navigateFresh(route); await ready();
      await browser.fill('textarea', 'Keep this unsent draft.');
      await openMenu();
      await until(() => browser.evaluate(`!!document.querySelector('[role="menu"]')`), 'account menu opens');
      const hits = await browser.evaluate(`(() => {const menu=document.querySelector('[role="menu"]');const r=menu.getBoundingClientRect();return {bounds:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight},rows:[...menu.querySelectorAll('[role="menuitem"]')].filter(item=>!item.disabled&&!item.hasAttribute('data-disabled')).map(item=>{const r=item.getBoundingClientRect();return {label:item.textContent.trim(),hits:[.1,.5,.9].map(f=>{const hit=document.elementFromPoint(r.left+r.width*f,r.top+r.height/2);return {inside:item.contains(hit),hit:hit?.textContent?.slice(0,70),tag:hit?.tagName,className:hit?.className};})};})};})()`);
      assert.equal(await browser.evaluate('document.documentElement.dataset.skin'),skin);
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
      await until(() => browser.evaluate(`!document.querySelector('[role="menu"]')`), 'selected menu finishes closing');
      assert.ok(await browser.evaluate(`!!document.querySelector('button[aria-label="Back from Settings"]')`), 'Settings provides an explicit way back');
      await browser.click('Back from Settings'); await ready();
      assert.equal(await browser.evaluate(`location.pathname+location.search`), route, 'Return to the exact origin including its selected workspace');
      assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Keep this unsent draft.');
      await openMenu();
      await until(() => browser.evaluate(`!!document.querySelector('[role="menu"][data-state="open"]') && !!document.activeElement?.closest('[role="menu"]')`), 'menu focus is ready for Escape');
      await key('Escape','Escape',27);
      await until(() => browser.evaluate(`!document.querySelector('[role="menu"]')`), 'Escape dismisses the menu');
      await until(() => browser.evaluate(`document.activeElement?.getAttribute('aria-label')==='Open account menu'`), 'Escape restores focus to the gear');
      console.log(`PASS ${skin} ${theme} ${collapsed?'rail':'sidebar'}: pointer targets, bounds, Settings return and draft preservation.`);
    }
  }
  // A Settings section/hash and a reload must not replace the originating screen.
  await browser.evaluate(`window.dispatchEvent(new CustomEvent('autohand-squad:menu',{detail:{action:'settings'}}))`);
  await until(() => browser.evaluate(`location.pathname==='/settings'`), 'native settings action');
  await browser.evaluate(`location.hash='settings-chat'`);
  const beforeReload = await browser.evaluate('window.accountDocumentId');
  await browser.send('Page.reload');
  await until(() => browser.evaluate(`window.accountDocumentId!==${JSON.stringify(beforeReload)} && !document.getElementById('boot') && !!document.querySelector('button[aria-label="Back from Settings"]')`), 'reopened Settings');
  await browser.click('Back from Settings'); await ready();
  assert.equal(await browser.evaluate(`location.pathname+location.search`), route);
  assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Keep this unsent draft.');
  // Keyboard opening, roving focus and selection use the same menu behavior.
  await browser.evaluate(`document.querySelector('button[aria-label="Open account menu"]').focus()`);
  await key('ArrowDown','ArrowDown',40);
  await until(() => browser.evaluate(`document.activeElement?.getAttribute('role')==='menuitem'`), 'keyboard focuses first action');
  await key('Home','Home',36);
  await until(() => browser.evaluate(`document.activeElement?.textContent.trim()==='Needs you'`), 'first keyboard action');
  await key('ArrowDown','ArrowDown',40);
  await until(() => browser.evaluate(`document.activeElement?.textContent.trim()==='Settings'`), 'keyboard reaches Settings');
  await key('Enter','Enter',13);
  await until(() => browser.evaluate(`location.pathname==='/settings'`), 'keyboard Settings selection');
  await browser.click('Back from Settings'); await ready();
  for (const [skin, theme] of [['soft','light'],['grut','dark'],['default','light']]) {
    await browser.send('Emulation.setDeviceMetricsOverride', {width:390,height:780,deviceScaleFactor:1,mobile:false});
    await browser.evaluate(`localStorage.setItem('autohandSquad.v1.skin',${JSON.stringify(skin)});localStorage.setItem('autohandSquad.v1.theme',JSON.stringify({mode:${JSON.stringify(theme)}}));`);
    await navigateFresh(route); await ready();
    await openMenu();
    await until(() => browser.evaluate(`!!document.querySelector('[role="menu"]')`), 'narrow menu opens');
    const bounds = await browser.evaluate(`(() => {const r=document.querySelector('[role="menu"]').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()`);
    assert.ok(bounds.left>=0 && bounds.top>=0 && bounds.right<=390 && bounds.bottom<=780, `${skin} menu stays inside a narrow window`);
    await pointerClick(await menuItem('Settings'));
    await until(() => browser.evaluate(`location.pathname==='/settings'`), 'narrow Settings action');
    await browser.click('Back from Settings'); await ready();
    assert.equal(await browser.evaluate(`location.pathname+location.search`), route);
    console.log(`PASS ${skin} narrow window: menu bounds, pointer selection and return.`);
  }
  await browser.send('Emulation.setDeviceMetricsOverride', {width:1170,height:760,deviceScaleFactor:1,mobile:false});
  for (const origin of ['/squad?query=Alex', '/work?view=all-work', '/squad-members/'+member.id+'/home']) {
    await navigateFresh(origin);
    await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Open account menu"]')`), 'origin screen');
    await browser.evaluate(`window.dispatchEvent(new CustomEvent('autohand-squad:menu',{detail:{action:'settings'}}))`);
    await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Back from Settings"]')`), 'Settings from another screen');
    await browser.click('Back from Settings');
    assert.equal(await browser.evaluate(`location.pathname+location.search`), origin);
  }
  await navigateFresh('/settings?section=chat');
  await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Back from Settings"]')`), 'direct Settings link');
  await browser.click('Back from Settings');
  assert.equal(await browser.evaluate(`location.pathname`), '/squad', 'A fresh direct link has a safe app-home fallback');
  assert.deepEqual(browser.errors, []);
  console.log('PASS native Settings entry, section/reload return, keyboard selection, Escape focus, directory/work/profile return and direct-link fallback; no provider invoked.');
} catch (error) {
  if (browser) {
    await writeFile(artifact+'/failure-state.json', JSON.stringify(await browser.evaluate(`({url:location.href,focus:document.activeElement?.outerHTML.slice(0,1000),scroll:scrollY,gears:[...document.querySelectorAll('button[aria-label="Open account menu"]')].map(button=>({html:button.outerHTML,bounds:button.getBoundingClientRect().toJSON()})),menus:[...document.querySelectorAll('[role="menu"]')].map(menu=>menu.outerHTML.slice(0,1200))})`),null,2));
    await browser.screenshot(artifact+'/failure.png');
  }
  throw error;
} finally { await browser?.close(); await bridge.close(); }
