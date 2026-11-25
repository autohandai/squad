// Settings › Computers in the app against a real bridge (ADR-0282): where
// members run (This computer, Over SSH with its add form and a real ssh test
// that fails with a sentence, the cloud provider dialog with its steps, other
// computers in the account), then Phones with "Reach from anywhere" through
// Squad relay by Autohand and its relay address (a non-HTTPS relay refused).
import assert from 'node:assert/strict';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const shots = process.env.COMPUTERS_SHOTS || '.codex-artifacts/computers';
const bridge = await startBridge({ prepare: prepareModelRoutingFixture });
let browser;
try {
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(bridge.origin + '/settings/computers');
  const text = () => browser.evaluate('document.querySelector("[data-testid=run-places]")?.innerText || ""');
  await until(async () => /This computer/.test(await text()), 'Where members run', 60000);
  const page = await text();
  for (const heading of ['This computer', 'Over SSH', 'Cloud computers', 'Other computers in your account']) assert.ok(page.includes(heading), heading);
  assert.match(page, /Online · \d+ members? runs? here/);
  await until(async () => /Sign in to see|Turn on Reach from anywhere|No other computers|This relay can/.test(await text()), 'account computers answered');
  await browser.screenshot(`${shots}/computers-1-page.png`);

  // Over SSH: the add form tests with the real ssh and answers in a sentence.
  await browser.click('Add a computer over SSH');
  await until(() => browser.evaluate('Boolean(document.querySelector("[data-testid=ssh-add-form]"))'), 'SSH form');
  await browser.fill('#ssh-user', 'igor');
  await browser.fill('#ssh-host', 'squad-check.invalid');
  await browser.click('Test');
  await until(() => browser.evaluate('document.querySelector("[data-testid=ssh-result]")?.innerText || ""'), 'ssh test sentence', 30000);
  const sentence = await browser.evaluate('document.querySelector("[data-testid=ssh-result]").innerText');
  assert.match(sentence, /could not be found|did not answer|could not be reached|not installed/, sentence);
  await browser.fill('#ssh-host', '-oProxyCommand=touch');
  await browser.click('Test');
  await until(async () => /host name or IP address/.test(await browser.evaluate('document.querySelector("[data-testid=ssh-result]")?.innerText || ""')), 'an option-looking host is refused');
  await browser.screenshot(`${shots}/computers-2-ssh.png`);
  await browser.click('Cancel');

  // Cloud: a provider list, then steps that end in Add it over SSH.
  await browser.click('New cloud computer');
  await until(() => browser.evaluate('Boolean(document.querySelector("[data-testid=cloud-provider-hetzner]"))'), 'providers listed');
  assert.ok(!/\$|€|a month/.test(await browser.evaluate('document.querySelector("[data-testid=cloud-dialog]").innerText')), 'no prices');
  await browser.screenshot(`${shots}/computers-3-cloud.png`);
  await browser.evaluate('document.querySelector("[data-testid=cloud-provider-hetzner]").click()');
  await until(async () => /squad serve/.test(await browser.evaluate('document.querySelector("[data-testid=cloud-dialog]").innerText')), 'setup steps');
  await browser.screenshot(`${shots}/computers-4-cloud-steps.png`);
  await browser.click('Add it over SSH');
  await until(() => browser.evaluate('!document.querySelector("[data-testid=cloud-dialog]")'), 'the cloud dialog closed');
  await until(() => browser.evaluate('Boolean(document.querySelector("[data-testid=ssh-add-form]"))'), 'the SSH form opens from the cloud steps');
  await browser.click('Cancel');

  // Phones: Reach from anywhere names the relay; a custom one must be HTTPS.
  await until(() => browser.evaluate('Boolean(document.querySelector("[data-testid=relay-address]"))'), 'relay address', 30000);
  const phones = await browser.evaluate('document.querySelector("[data-testid=computers-settings]").innerText');
  assert.match(phones, /Reach from anywhere/); assert.match(phones, /Through Squad relay by Autohand/);
  assert.match(await browser.evaluate('document.querySelector("[data-testid=relay-address]").innerText'), /squad\.autohand\.ai|127\.0\.0\.1|localhost/);
  await browser.click('Use a different relay');
  await browser.fill('[data-testid=relay-address] input', 'http://relay.example.com');
  await browser.click('Use this relay');
  await until(async () => /HTTPS address/.test(await browser.evaluate('document.querySelector("[data-testid=relay-problem]")?.innerText || ""')), 'a non-HTTPS relay is refused with a sentence', 20000)
    .catch(async error => { console.error((await browser.evaluate('document.body.innerText')).slice(0, 3000)); await browser.screenshot(`${shots}/computers-fail.png`); throw error; });
  const saved = (await bridge.api('/api/mobile/status')).data.config.relayUrl;
  assert.equal(saved, '', 'the refused relay was not saved');
  await browser.evaluate('document.querySelector("[data-testid=relay-address]").scrollIntoView({ block: "center" })');
  await browser.screenshot(`${shots}/computers-5-relay.png`);
  console.log('Computers browser check passed: sections, SSH test sentence and option refusal, cloud provider steps to the SSH form, Reach from anywhere through Squad relay by Autohand, non-HTTPS relay refused and not saved.');
} finally {
  await browser?.close();
  await bridge.close?.();
}
process.exit(0);
