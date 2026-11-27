import { test, expect } from "@playwright/test";

// The sign-in and update screens (ADR-0245) in light and dark, every state
// they can show, the perch's motion, and its stillness under reduced motion.
const fixture = (params) => `/e2e/fixtures/signin-update.html?${new URLSearchParams(params)}`;
const shot = (page, testInfo, name) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const theme of ["light", "dark"]) {
  test(`sign-in states, ${theme}`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture({ view: "signin", theme }));
    const gate = page.getByTestId("sign-in-gate");
    const flock = gate.locator(".squad-flock");
    await expect(gate.getByRole("button", { name: "Continue with Autohand account" })).toBeEnabled();
    await expect(gate.getByRole("button", { name: "Continue with Apple" })).toBeEnabled();
    await expect(gate).not.toContainText("autohand login");
    await expect(gate).not.toContainText("terminal");
    await expect(gate.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "https://autohand.ai/policies/");
    await expect(gate.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "https://autohand.ai/policies/privacy-policy/");
    await expect(flock).toHaveAttribute("data-mood", "idle");
    expect((await flock.getAttribute("data-flock")).split(" ")).toContain("kiwi");
    const idleBox = await flock.boundingBox();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, testInfo, `signin-idle-${theme}`);

    await gate.getByRole("button", { name: "Continue with Apple" }).click();
    await expect(gate.getByTestId("sign-in-code")).toHaveText("WXYZ-2345");
    await expect(gate).toContainText("Continue with Apple on autohand.ai");
    await expect(gate.getByTestId("sign-in-url")).toContainText("provider=apple");
    await expect(flock).toHaveAttribute("data-mood", "waiting");
    // The perch keeps its box from mood to mood: nothing around it moves.
    expect(await flock.boundingBox()).toEqual(idleBox);
    await shot(page, testInfo, `signin-waiting-apple-${theme}`);

    await gate.getByRole("button", { name: "Cancel sign-in" }).click();
    await expect(gate).toContainText("Sign-in was cancelled");
    await expect(flock).toHaveAttribute("data-mood", "idle");
    await shot(page, testInfo, `signin-cancelled-${theme}`);

    await gate.getByRole("button", { name: "Continue with Autohand account" }).click();
    await expect(gate).toContainText("Sign in on autohand.ai");
    await shot(page, testInfo, `signin-waiting-${theme}`);

    await page.goto(fixture({ view: "signin", theme, fail: "1" }));
    await page.getByRole("button", { name: "Continue with Autohand account" }).click();
    await expect(page.getByRole("alert")).toContainText("Could not reach autohand.ai");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator(".squad-flock")).toHaveAttribute("data-mood", "error");
    await shot(page, testInfo, `signin-error-${theme}`);

    await page.goto(fixture({ view: "signin", theme, offline: "1" }));
    await expect(page.getByRole("button", { name: "Continue with Autohand account" })).toBeDisabled();
    await expect(page.getByTestId("sign-in-gate")).toContainText("local service isn’t answering");
    await expect(page.locator(".squad-flock")).toHaveAttribute("data-mood", "asleep");
    await shot(page, testInfo, `signin-offline-${theme}`);
    expect(errors).toEqual([]);
  });

  test(`update screen and Settings perch, ${theme}`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const [phase, word] of [["preparing", "Getting ready…"], ["installing", "Installing…"], ["restarting", "Reopening…"]]) {
      await page.goto(fixture({ view: "update", theme, phase }));
      const screen = page.getByTestId("update-screen");
      await expect(screen.getByRole("heading")).toHaveText("Updating Squad to 0.1.24");
      await expect(screen.getByTestId("update-screen-status")).toHaveText(word);
      // Installing stops work: the screen must not claim the squad keeps working.
      await expect(screen).not.toContainText("keeps working");
      await expect(screen.getByRole("progressbar")).toHaveCount(0);
      await shot(page, testInfo, `update-${phase}-${theme}`);
    }
    await page.goto(fixture({ view: "update", theme, phase: "failed" }));
    const failed = page.getByTestId("update-screen");
    await expect(failed.getByRole("heading")).toHaveText("The update didn’t finish");
    await expect(failed.getByRole("alert")).toContainText("macOS refused");
    await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(failed.getByRole("button", { name: "Download the latest version" })).toBeVisible();
    await expect(failed.locator(".squad-flock")).toHaveAttribute("data-mood", "error");
    await shot(page, testInfo, `update-failed-${theme}`);

    await page.goto(fixture({ view: "settings", theme, phase: "downloading", percent: "42" }));
    const perch = page.getByTestId("update-perch");
    await expect(perch).toHaveAttribute("role", "progressbar");
    await expect(perch).toHaveAttribute("aria-valuenow", "42");
    await expect(page.getByRole("progressbar")).toHaveCount(1);
    await expect(page.getByTestId("software-update")).toContainText("Your squad keeps working while this downloads");
    await expect(perch.locator(".squad-flock")).toHaveAttribute("data-mood", "progress");
    await shot(page, testInfo, `settings-downloading-${theme}`);
    await page.goto(fixture({ view: "settings", theme, phase: "downloading-unknown" }));
    await expect(page.getByTestId("update-perch")).not.toHaveAttribute("role", "progressbar");
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByTestId("update-perch").locator(".squad-flock")).toHaveAttribute("data-mood", "waiting");
    await shot(page, testInfo, `settings-downloading-unknown-${theme}`);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("the perch moves, and holds still under reduced motion", async ({ page }) => {
  const animations = () => page.evaluate(() => [...document.querySelectorAll(".squad-flock-body, .squad-flock-land")].map(node => getComputedStyle(node).animationName));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(fixture({ view: "update", phase: "installing" }));
  await expect.poll(async () => (await animations()).filter(name => name === "flock-wave").length).toBeGreaterThan(0);
  await page.goto(fixture({ view: "settings", phase: "downloading", percent: "60" }));
  await expect.poll(async () => (await animations()).includes("flock-walk")).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const params of [{ view: "signin" }, { view: "update", phase: "installing" }, { view: "settings", phase: "downloading" }]) {
    await page.goto(fixture(params));
    await expect(page.locator(".squad-flock")).toBeVisible();
    expect(new Set(await animations())).toEqual(new Set(["none"]));
    // Still birds are fully drawn at once, not stuck mid-landing.
    const opacity = await page.evaluate(() => [...document.querySelectorAll(".squad-flock-land")].map(node => getComputedStyle(node).opacity));
    expect(new Set(opacity)).toEqual(new Set(["1"]));
  }
  // The boot screen's birds also sit still. The app bundle is held back so
  // the boot screen stays up to be measured.
  await page.route("**/src/App.jsx", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.goto("/");
  const boot = await page.evaluate(() => [...document.querySelectorAll("#boot-flock > span")].map(node => getComputedStyle(node).animationName));
  expect(boot.length).toBe(3);
  expect(new Set(boot)).toEqual(new Set(["none"]));
});

test("the boot screen paints three birds on a perch before the bundle", async ({ page }, testInfo) => {
  await page.route("**/src/App.jsx", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
    await page.goto("/");
    const birds = page.locator("#boot-flock > span > svg");
    await expect(birds).toHaveCount(3);
    await expect(page.locator("#boot-status")).toHaveText("Starting Squad…");
    // The mark itself stays still (DESIGN.md: never animate the logo).
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("boot-mark")).animationName)).toBe("none");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#boot-flock > span")).animationName)).toContain("boot-hop");
    await page.screenshot({ path: testInfo.outputPath(`boot-${colorScheme}.png`), animations: "disabled" });
  }
});
