#!/usr/bin/env node
import assert from "node:assert/strict";
import { getNativeNotificationClient, normalizeNativeNotificationPermission, notificationTestMessage } from "../src/lib/native-notifications.js";

let passed = 0;
async function check(name, run) { await run(); console.log(`ok ${++passed} - ${name}`); }
function fixture(initial = "granted", requested = "granted", testResult = { posted: true, method: "macos-user-notifications" }) {
  const calls = [];
  let permission = initial;
  const client = getNativeNotificationClient({ userAgent: "AutohandSquadDesktop/0.1.5 (macos; aarch64)", async invoke(command, args) {
    calls.push({ command, args });
    if (command === "squad_notification_permission") {
      if (args.request) permission = requested;
      return { permission };
    }
    if (command === "squad_notification_test") return testResult;
    return null;
  } });
  return { client, calls };
}

await check("only macOS Squad main and quick-chat shells expose native controls", () => {
  for (const userAgent of ["Mozilla/5.0", "AutohandSquadDesktop/0.1.5 (linux; x86_64)", "AutohandSquadDesktop/0.1.5 (windows; x86_64)", "OtherApp/0.1.5 (macos)"]) assert.equal(getNativeNotificationClient({ userAgent, invoke() {} }), null);
  assert.equal(getNativeNotificationClient({ userAgent: "AutohandSquadDesktop/0.1.5 (macos)", invoke: undefined }), null);
  assert.ok(getNativeNotificationClient({ userAgent: "AutohandSquadQuickChat/0.1.5 (macos)", invoke() {} }));
});
await check("reading permission never prompts or posts", async () => {
  const { client, calls } = fixture("not-determined");
  assert.equal(await client.permission(), "not-determined");
  assert.deepEqual(calls, [{ command: "squad_notification_permission", args: { request: false } }]);
});
await check("explicit enable reads permission before requesting not-determined state", async () => {
  const { client, calls } = fixture("not-determined");
  assert.equal(await client.permission({ request: true }), "granted");
  assert.deepEqual(calls.map((call) => call.args.request), [false, true]);
});
await check("previous denial cannot be re-prompted or treated as granted", async () => {
  const { client, calls } = fixture("denied");
  assert.equal(await client.permission({ request: true }), "denied");
  await assert.rejects(client.test({ requestPermission: true }), /System Settings/);
  assert.ok(calls.every((call) => call.command === "squad_notification_permission" && call.args.request === false));
});
await check("explicit test can request permission then posts only after grant", async () => {
  const { client, calls } = fixture("not-determined");
  assert.equal((await client.test({ requestPermission: true })).posted, true);
  assert.deepEqual(calls.map((call) => [call.command, call.args?.request]), [["squad_notification_permission", false], ["squad_notification_permission", true], ["squad_notification_test", undefined]]);
});
await check("denied prompt prevents notification submission", async () => {
  const { client, calls } = fixture("not-determined", "denied");
  await assert.rejects(client.test({ requestPermission: true }), /System Settings/);
  assert.ok(!calls.some((call) => call.command === "squad_notification_test"));
});
await check("passive test does not request never-asked permission", async () => {
  const { client, calls } = fixture("not-determined");
  await assert.rejects(client.test(), /Enable notifications/);
  assert.equal(calls.length, 1);
});
await check("unknown/unsupported permission never becomes a grant", async () => {
  for (const value of ["unsupported", "unknown", "authorized", true, null]) {
    const { client, calls } = fixture(value);
    await assert.rejects(client.test({ requestPermission: true }), /Could not confirm/);
    assert.equal(calls.length, 1);
  }
  assert.equal(normalizeNativeNotificationPermission("granted"), "granted");
  assert.equal(normalizeNativeNotificationPermission("future-state"), "unknown");
  assert.equal(normalizeNativeNotificationPermission(undefined), "unknown");
});
await check("test success requires explicit posted true", async () => {
  for (const result of [{ posted: false }, { queued: true }, {}, null]) {
    const { client } = fixture("granted", "granted", result);
    await assert.rejects(client.test(), /did not confirm/);
    assert.throws(() => notificationTestMessage(result), /not accepted/);
  }
});
await check("test text reports submission and retains native display limitation", () => {
  const text = notificationTestMessage({ posted: true, method: "macos-user-notifications" });
  assert.match(text, /macOS accepted/);
  assert.match(text, /Focus mode/);
  assert.ok(!/delivered|sent\./i.test(text));
  assert.equal(notificationTestMessage({ posted: true, message: " macOS accepted the test. " }), "macOS accepted the test.");
  assert.match(notificationTestMessage({ posted: true, method: "notify-send" }), /^Notification submitted/);
});
await check("settings invokes one fixed command without a client-provided URL", async () => {
  const { client, calls } = fixture();
  await client.openSettings();
  assert.deepEqual(calls, [{ command: "squad_notification_settings", args: undefined }]);
});
await check("native invocation failure propagates without fallback", async () => {
  const client = getNativeNotificationClient({ userAgent: "AutohandSquadDesktop/0.1.5 (macos)", invoke() { throw new Error("Native permission reader failed"); } });
  await assert.rejects(client.test({ requestPermission: true }), /Native permission reader failed/);
  const rejectedString = getNativeNotificationClient({ userAgent: "AutohandSquadDesktop/0.1.5 (macos)", invoke() { return Promise.reject("macOS permission read timed out"); } });
  await assert.rejects(rejectedString.permission(), /macOS permission read timed out/);
});
console.log(`${passed} native notification checks passed; all commands mocked.`);
