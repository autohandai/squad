# ADR-0245: Sign-in and update screens, and the perch

Status: Accepted
Date: 2026-11-17
Amends: ADR-0240 (bird faces gain a motion contract on these screens),
ADR-0144 (what the update screen may say during an install)

## Context

The owner asked to "redesign the login screen, update screen … they're
animated", pointing at the Noda app's redesign, and added: "autohand supports
sign in with apple, and since squad comes with built-in autohand cli we don't
need to say that, since we login share from squad to cli automatically. the
login screen could show some cool animations of the new avatars we just
created as it loads or updates".

What was there:

- Sign-in (`SignInGate.jsx`): a static mark, "Sign in to your squad", one
  "Continue with Autohand account" button, then "Prefer a terminal? Run
  `autohand login`, then check again" and Check again.
- Updates had no screen of their own. Install and restart went straight from a
  Settings button to the bridge and then to `squad_quit_for_update`, which
  exits the app; whatever page was open stayed on screen meanwhile.
- The boot screen in `index.html` pulsed the mark, against the DESIGN.md rule
  "do not animate the logo", and painted the dark mark on its light variant.

Reference points, read for capability and tone only:

- Grok Bot (a competitor; its look is off limits): a signed-out page with a
  large mark, one promise line, a quiet "Sign in →" and a terms line; an update
  screen with a mascot whose face coalesces from dots and whose eyes glance, a
  thin bar with a status word then a percentage, and a "Download the latest
  version" fallback.
- Noda (`src/update_ui.rs`): states named plainly ("Checking the update…",
  "Downloading… 42%", "Restart to update to {version}", "Check again"), and no
  promise the app cannot keep.

What Squad actually does during an update, read from the code, because the
brief allowed "Your squad keeps working" only if it was true:

- Downloads run in the bridge's background loop; `server.mjs` says "Downloads
  never invoke the installer, stop work, or close the application". True.
- Installing calls `canRestart`, which runs
  `stopManagedRuns("Stopped to install the Squad update.")`, pauses goals so
  they can resume and keeps queued work (ADR-0144), then the app exits. So
  during an install the squad does **not** keep working.

## Decision

### The perch

One animated character for these screens, `SquadFlock`
(`src/components/brand/SquadFlock.jsx`): a few birds from the cast sitting on
one hairline. The kiwi is always there (`pickFlock` in `src/lib/flock.js`);
the others are drawn from `BIRD_FACE_IDS`, so the 300-bird cast from the
avatars lane appears without a change here. Moods:

- idle: the birds land one after another, then each glances, hops or peeks on
  its own slow clock (7 s and up, staggered), never together;
- waiting: a hop passes along the row every 1.8 s;
- progress: only with a measured download. The perch becomes the progress bar:
  the line fills to the kiwi, which walks from the start towards the other
  birds waiting at the far end;
- error: all stop and settle, slightly tilted; asleep (bridge down): dimmed.

Why this and not Grok Bot's mascot: Grok's character is one creature that
assembles itself from particles and watches a separate bar. Squad's product is
a team, and these faces are the members' own avatars, so the character is
several distinct birds, and the bar, when there is one, is the thing they sit
on. There are no particles, no single mascot, no eye animation and no bar
without a measurement (DESIGN.md: "a bar that measures nothing is a lie told
smoothly").

Eyes do not move. They are even-odd holes cut into the face path by
`birdFaceSvg`; moving them means editing `bird-faces.js`, which the avatars
lane owns. Body motion (land, tilt, hop, squash, walk) carries the character.

Each bird sits on its member tile (`member-face bg-muted`, `data-slot=avatar`),
as everywhere else (ADR-0240). The first version drew them without a tile; in
the dark screenshots the puffin and tūī all but disappeared into the page.

Motion is transforms and opacity on three nested spans (seat slides, bird
lands once, body loops), inside a box of fixed size. Under
`prefers-reduced-motion: reduce` every animation and transition is off and
the birds are drawn fully in place.

### Sign-in

A centred column anchored from the top: the mark (still), "Autohand Squad",
"Your team of agents, in one place.", the perch, **Continue with Autohand
account**, **Continue with Apple**, and at the foot "By continuing, you agree
to Autohand's Terms and Privacy Policy" linking `autohand.ai/policies/` and
`autohand.ai/policies/privacy-policy/` (the paths the autohand.ai login page
uses). The terminal hint is gone and the CLI is not mentioned. Check again
moved into the failed state beside Try again.

States, each in words: opening the browser; waiting ("Sign in on autohand.ai.
Squad picks it up on its own.", or "Continue with Apple on autohand.ai…"),
with the code, the link, Open the sign-in page, Copy link/code, Cancel
sign-in and Start over kept as before; cancelled ("Sign-in
was cancelled…"); failed (the error, Try again, Check again); local service not
answering (buttons off, birds asleep).

The first layout was vertically centred. The browser check measured the perch
moving 67 px up on a phone when the waiting details appeared, so the column is
now anchored at `max(3rem, 50svh − 13rem)` and grows downward.

Before the owned app sets a theme class, the root carries the dark tokens, so
sign-in opened dark straight after a light boot screen. The gate now adopts
the boot screen's choice (saved theme, else the system's) when the root has
no theme class.

### Sign in with Apple

What the website does today (`dark-web-cli`, read only):

- The device-login page the CLI opens, `/cli-auth?code=…&source=squad`, shows
  "Sign In Required" to a signed-out visitor; its button goes to
  `/signin/?return=<that page>`.
- The login page offers Continue with Apple. Its handler stores the return URL
  in a `cli_return_url` cookie and sends the browser to
  `/api/auth/oauth/apple`; the Apple callback returns to that cookie's URL, and
  `/cli-auth` then authorises the device.
- Nothing reads a provider hint. `/api/auth/oauth/apple` opened directly would
  sign the person in but return to `/platform/`, because Squad cannot set the
  `cli_return_url` cookie on autohand.ai. So going straight to Apple needs a
  website change.

Squad's side, which works today and improves when the site does:

- `POST /api/harnesses/login` accepts `provider: "apple"` (the ownership
  broker's strict schema allows exactly that); the bridge passes
  `AUTOHAND_SQUAD_LOGIN_PROVIDER=apple` to the bundled `squad login`.
- The Squad CLI (`daemon/src/auth.rs`, `with_provider_hint`) appends
  `provider=apple` to the URL it prints and opens; unknown values are dropped.
- The bridge's re-opener adds the same hint (`signInUrlWithProvider` in
  `server/harness/open-login.mjs`) for a CLI that predates this, https only.
- Until the site reads the hint, the person lands on the ordinary page and
  reaches Apple through Sign In to Continue → Continue with Apple. The waiting
  copy ("Continue with Apple on autohand.ai") is true either way.

What `dark-web-cli` needs, not changed here:

1. `src/components/CliAuthPage.vue`: when `provider=apple` is present and the
   visitor is signed out, skip "Sign In Required" and go to
   `/signin/?return=<this URL>&provider=apple`. After Apple returns, the
   visitor is signed in, so the page authorises instead of looping; an
   `auth_error` is shown before any redirect, so a failure cannot loop either.
2. `src/components/LoginPage.vue`: on mount, when `provider=apple` and a valid
   `return` are present, run the existing `handleOAuth('apple')` (it sets
   `cli_return_url` and redirects).
3. `CliAuthPage.vue` names the requester from `source`, which knows
   commander, zed, jetbrains, vscode and ios; `source=squad` falls through to
   "the Autohand CLI". Add `squad` → "Autohand Squad".

### Update screen

`UpdateScreen` (`src/components/account/UpdateScreen.jsx`) owns the window
from the moment the person chooses Install and restart in the desktop app
until Squad closes: "Updating Squad to 0.1.24", the perch waiting, one
sentence per step, and a status word (Getting ready, Installing, Reopening).
Getting ready says running work is being stopped and paused goals and queued
messages are kept; it never says the squad keeps working. If the bridge refuses
the install, the quit fails, or the phase returns with an error, it says
"The update didn't finish", the error, Try again, Back to Squad and Download
the latest version (the releases page).

It opens only from an install chosen in this window, not from a persisted
`installing` phase: a stale phase after a crash would otherwise hold the window
with no way out.

Settings › Updates puts the perch above the status while the updater is busy.
With a measured total the perch is the progress bar: the wrapper carries
`role=progressbar` and `aria-valuenow`, and the Radix bar is not drawn there
(the sidebar keeps it). Without a total there is no progressbar role, as
before. Downloading and verifying say "Your squad keeps working while this
downloads. Installing waits until you choose it."

### Boot screen

The mark no longer pulses. Three birds sit on a perch under the name, landing
then passing a hop along while the bundle loads; they are drawn into
`index.html` at build time by a small Vite plugin (`bootFlock` in
`vite.config.js`, seeded so a build is repeatable). The light boot screen now
uses the light mark. The quick-chat popover's compact boot still shows one
line and no birds.

## Evidence

Commands run in the lane worktree:

- `cargo test --lib auth::` (daemon, rustc 1.97.1): 3 passed, including
  `adds_only_known_provider_hints`.
- `node scripts/check-sign-in-opener.mjs`: provider hint only for known
  providers on https pages, plus the existing opener checks.
- `bun run check:sign-in-recovery:browser` against a real dev bridge with a
  fixture `squad` CLI: the existing URL/code/copy/cancel/start-over/relaunch
  checks, plus Continue with Apple reaching the CLI as
  `AUTOHAND_SQUAD_LOGIN_PROVIDER`, the cancelled notice, and the bridge opener
  adding `&provider=apple` for a CLI that ignores the variable.
- `bun run check:signin-update:browser` (new, `e2e/signin-update.spec.mjs`):
  every sign-in state, the update screen's four states and the Settings perch,
  in light and dark, desktop and iPhone 13 sizes; the perch's box unchanged
  between idle and waiting; no horizontal scroll; animations running without a
  motion preference and `none` with every bird at opacity 1 under reduced
  motion, boot screen included. 52 screenshots were written; the sign-in
  idle/waiting/error/offline, update installing/failed, Settings downloading
  and boot light/dark ones were read by eye.
- `check:jsx`, `check:render`, `check:skins`, `check:desktop-updates`,
  `check:update-flow`, `check:updates:playwright` pass. `check:onboarding:browser`
  (`/api/runtime` has no data for a signed-out bridge) and `check:updates:browser`
  (times out on its first "never-checked" state) fail identically on an
  untouched checkout of main `ab7521b`, so neither is caused by this change.
- `bun run build` succeeds and `dist/index.html` carries the three boot birds.

## Consequences

- Straight-to-Apple waits on the website change above. Until then Continue
  with Apple is the same device login plus a hint the page ignores, and the
  copy tells the person what to pick.
- The provider hint in the Squad CLI ships with the next Squad build; the
  installed app's bundled CLI ignores it, and the bridge re-opener covers only
  the Open the sign-in page button, not the browser the CLI opens itself.
- The Rust change was only unit-tested; no app bundle was built in this lane.
- 60 fps was not measured. Motion is limited to compositor properties by
  construction; a frame trace on a real machine has not been taken.
- Birds are random per mount (seeded in tests). Someone may meet a bird they
  do not have as a member; that is intended, the cast is the squad's world.
- In the default skin the tiles are soft squares, so the perch reads more as
  a row of member avatars than as birds on a wire. Tile-less faces read
  better in light but lose dark birds in dark; consistency with ADR-0240 won.
- The native Tauri start-up page (served by Rust before the bridge) still
  shows its mark and check rows without birds; it is outside this lane.
- The sidebar update notice is unchanged apart from sharing `UpdateProgress`.
