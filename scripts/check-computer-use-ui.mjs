import assert from "node:assert/strict";
import { computerUseAttachments, evidenceForMessage, getComputerUseConsentClient } from "../src/components/computer-use/model.js";

const file = (name, type = "image/png") => ({ name, mediaType: type, size: 300, url: `/api/computer-use/evidence/session-1/${name}` });
const screenshot = file("recording/action-1/click.png");
const detail = file("recording/action-1/action.json", "application/json");
assert.equal(getComputerUseConsentClient({ userAgent: "Mozilla/5.0", invoke() { throw new Error("Browser must not invoke native consent"); } }), null);
assert.equal(getComputerUseConsentClient({ userAgent: "AutohandSquadQuickChat/0.1.5 (macos)", invoke() {} }), null);
const calls = [];
const native = getComputerUseConsentClient({ userAgent: "AutohandSquadDesktop/0.1.5 (macos)", invoke: async (...args) => { calls.push(args); return { confirmed: false }; } });
await native.confirm("asq_eva", "observe");
await native.confirm("asq_eva", "control");
await native.revoke("asq_eva");
await native.setup();
assert.deepEqual(calls, [
  ["squad_confirm_computer_use", { memberId: "asq_eva", scope: "observe" }],
  ["squad_confirm_computer_use", { memberId: "asq_eva", scope: "control" }],
  ["squad_revoke_computer_use", { memberId: "asq_eva" }],
  ["squad_setup_computer_use", {}],
]);
const files = computerUseAttachments([screenshot, screenshot, detail, { ...screenshot, url: "https://example.com/screen.png" }, { ...screenshot, mediaType: "text/html" }]);
assert.equal(files.length, 2);
assert.equal(files[0].kind, "image");
assert.equal(files[1].kind, "file");
assert.deepEqual(evidenceForMessage({ computerUse: { sessionId: "session-1", files: [screenshot] } }, [{ id: "session-1", files: [screenshot, detail] }, { id: "session-2", files: [file("unrelated.png")] }]).map((item) => item.url), files.map((item) => item.url));
assert.deepEqual(evidenceForMessage({ role: "agent" }, [{ id: "session-1", files: [screenshot] }]), []);
console.log("Computer Use UI boundaries passed: trusted native-only consent, setup receipt, exact session evidence, duplicate and remote URL rejection.");
