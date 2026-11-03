import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { startBridge } from "../scripts/lib/reliability-browser.mjs";

test("Squad news opens, records steps and stays dismissed after reload", async ({ page }, info) => {
  let dismissed = false, refuseDismissal = true;
  const stepsSeen = [];
  const upstream = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/v1/announcements?")) {
      expect(new URL(req.url, "http://fixture").searchParams.get("clientType")).toBe("squad");
      res.end(JSON.stringify({ announcements: dismissed ? [] : [{ id: "squad-news", title: "A new way to keep Squad current", description: "Choose automatic downloads and install when you are ready.", placement: "sidebar", steps: [{ type: "image", mediaUrl: "https://media.autohand.ai/squad-fixture.png", title: "Your choice", description: "Automatic downloads are optional." }, { type: "image", mediaUrl: "https://media.autohand.ai/squad-fixture.png", title: "Ready when you are", description: "Installation waits for your consent." }] }] }));
    } else if (req.url.endsWith("/seen")) { stepsSeen.push(JSON.parse(body).lastStep); res.end('{"ok":true}'); }
    else if (req.url.endsWith("/dismiss")) {
      if (refuseDismissal) { res.writeHead(503); res.end('{}'); }
      else { dismissed = true; res.end('{"ok":true}'); }
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const bridge = await startBridge({ prepare: async () => ({ AUTOHAND_API_URL: `http://127.0.0.1:${upstream.address().port}` }) });
  try {
    await page.route("https://media.autohand.ai/squad-fixture.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }));
    await page.addInitScript(() => localStorage.setItem("autohandSquad.v1.onboarding", '{"version":1,"status":"skipped"}'));
    await page.goto(bridge.origin + "/settings/updates");
    const notice = page.getByTestId("squad-announcement");
    await expect(notice).toContainText("A new way to keep Squad current");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await notice.getByRole("button", { name: "Read announcement" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Your choice", exact: true })).toBeVisible();
    await expect.poll(() => stepsSeen).toContain(0);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(dialog).toContainText("2 of 2"); await expect.poll(() => stepsSeen).toContain(1);
    await page.screenshot({ path: info.outputPath("squad-news.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Try again");
    await expect(dialog).toBeVisible();
    refuseDismissal = false;
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(notice).toHaveCount(0);
    await page.reload(); await expect(notice).toHaveCount(0);
    expect(dismissed).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await bridge.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test("a modal announcement waits until another dialog is closed", async ({ page }) => {
  const bridge = await startBridge();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let dismissed = false;
  try {
    await page.clock.install();
    await page.route("**/api/announcements**", async route => {
      if (route.request().method() === "GET") {
        await gate;
        return route.fulfill({ json: { success: true, data: { announcements: dismissed ? [] : [{ id: "modal-news", title: "Squad product news", description: "A message after setup.", placement: "modal", steps: [] }] } } });
      }
      if (route.request().url().endsWith("/dismiss")) dismissed = true;
      return route.fulfill({ json: { success: true, data: { ok: true } } });
    });
    await page.addInitScript(() => localStorage.setItem("autohandSquad.v1.onboarding", '{"version":1,"status":"skipped"}'));
    await page.goto(bridge.origin + "/settings/system");
    await page.getByRole("button", { name: "Reset Squad…", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Reset Squad to a clean install?" })).toBeVisible();
    release();
    await expect(page.getByTestId("squad-announcement")).toBeVisible();
    await page.clock.fastForward(6000);
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Squad product news" })).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.clock.fastForward(6000);
    const news = page.getByRole("dialog");
    await expect(news.getByRole("heading", { name: "Squad product news" })).toBeVisible();
    await news.getByRole("button", { name: "Done", exact: true }).click();
    await expect(news).toHaveCount(0);
    expect(dismissed).toBe(true);
  } finally { release(); await bridge.close(); }
});
