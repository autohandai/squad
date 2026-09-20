# Contributing to Autohand Squad

Thanks for helping build Autohand Squad. Contributions of code, documentation,
design feedback, tests, and reproducible bug reports are welcome.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
Report security issues privately as described in [SECURITY.md](SECURITY.md),
not in a public issue.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss large features, new dependencies, architecture
  changes, data migrations, or changes to public behavior before investing in
  an implementation.
- Keep pull requests focused. Unrelated cleanup makes changes harder to review
  and revert.
- Never include credentials, access tokens, private prompts, customer data, or
  local Autohand state in an issue, commit, screenshot, or test fixture.

Small fixes and documentation improvements can go straight to a pull request.
If you are looking for a place to begin, browse issues labeled
[`good first issue`](https://github.com/autohandai/squad/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
or [`help wanted`](https://github.com/autohandai/squad/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22help%20wanted%22).

## Set up the project

You need Git, Node.js 18.17 or newer, Bun 1.3.13, and a stable Rust toolchain
with `rustfmt`. The Autohand CLI is also needed for live agent, chat, run, and
terminal flows.

[Fork the repository](https://github.com/autohandai/squad/fork), then clone
your fork and keep this repository as the upstream remote:

```bash
git clone https://github.com/YOUR-USERNAME/squad.git
cd squad
git remote add upstream https://github.com/autohandai/squad.git
bun install --frozen-lockfile
bun run build
cd daemon
cargo build --bins -j1
```

On Debian or Ubuntu, install the native tray build dependencies first:

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev pkg-config
```

Run the complete local stack from `daemon/`:

```bash
./target/debug/squad
```

Then open `http://127.0.0.1:19821/`. See [SETUP_GUIDE.md](SETUP_GUIDE.md)
for development modes, local state, configuration, and troubleshooting.

## Make a change

1. Create a branch from the latest `main`.
2. Make the smallest coherent change that solves the problem.
3. Add or update focused tests for changed behavior.
4. Update the relevant documentation when a public contract changes.
5. Run the checks appropriate to the files you touched.
6. Open a pull request and complete the template with evidence a reviewer can
   reproduce.

Use clear commit messages that explain the outcome, for example
`fix: keep packaged runtime state writable`. Maintainers may squash commits
when merging.

## Project conventions

- Read [DESIGN.md](DESIGN.md) before changing visible UI. Preserve the calm,
  minimal product style and use the existing design tokens and shadcn/ui
  primitives.
- Use `Autohand Squad` for the product, `specialized agent` in explanations,
  and `squad member` for a configured agent identity.
- Preserve existing routes, local state, and compatibility paths unless the
  change deliberately updates that contract.
- Keep trusted native components separate from any opt-in isolated sandbox.
- Do not commit generated local state such as `.autohand/`,
  `.codex-artifacts/`, `screenshots/`, generated `release/` artifacts, or
  credentials.
- Put intentional README media in `docs/assets/readme/`, with useful alt text
  and no private data.

Agent-assisted contributions are welcome. The contributor remains responsible
for understanding the change, reviewing every diff, running the relevant
checks, and removing fabricated, private, or unrelated content. Mention
material agent assistance in the pull request when it helps reviewers
understand how the change was produced or verified.

## Verify your work

Use the smallest checks that prove the change, then run `bun run ci` for broad
or release-impacting pull requests.

Web UI, copy, routes, or bridge changes:

```bash
bun run check:server
bun run check:onboarding
bun run build
```

Rust runtime, daemon, tray, state, or launcher changes:

```bash
cd daemon
cargo fmt -- --check
cargo test -j1 -- --test-threads=1
cargo build --bins -j1
```

Release, installer, workflow, or package-script changes:

```bash
bun run check:sdk
bun run check:release
```

For onboarding or channel UI changes, run the matching browser verifier and
describe the exact route and state you checked:

```bash
bun run check:onboarding:browser
bun run check:channels:browser
```

Generated proof belongs under `.codex-artifacts/` and must not be committed.

## Documentation responsibilities

- Update [README.md](README.md) for user-facing behavior, routes, setup, or
  distribution changes.
- Update [SETUP_GUIDE.md](SETUP_GUIDE.md) for development, state, validation,
  or troubleshooting changes.
- Update [docs/release.md](docs/release.md) for CI, installer, manifest, signing,
  or release-contract changes.
- Update [DESIGN.md](DESIGN.md) when the durable visual contract changes.

## Pull-request review

Maintainers review changes for correctness, scope, compatibility, security,
design consistency, and adequate proof. A pull request may need revision and
is not guaranteed to merge. Be responsive to review, keep discussion focused
on the work, and resolve feedback with new commits rather than rewriting other
contributors' work.

Unless stated otherwise, contributions accepted into this repository are
licensed under the repository's [MIT License](LICENSE).
