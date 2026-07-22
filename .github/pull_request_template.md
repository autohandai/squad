## Summary

Describe the user problem and the smallest change that solves it.

<!-- Link the issue with "Closes #123" when applicable. -->

## Release impact

- [ ] Web UI behavior changed
- [ ] Runtime or tray behavior changed
- [ ] Installer manifest or release artifact shape changed
- [ ] Telemetry, analytics, or local state changed
- [ ] No release-impacting behavior changed

## Verification

- [ ] `bun run check:server`
- [ ] `bun run build`
- [ ] `cd daemon && cargo fmt -- --check`
- [ ] `cd daemon && cargo test -j1 -- --test-threads=1`
- [ ] `cd daemon && cargo build --bins -j1`
- [ ] Release dry run or manifest packaging checked when relevant
- [ ] Exact changed route or native surface checked manually when relevant

List the commands you ran and any manual evidence. Leave irrelevant boxes
unchecked and explain what was not applicable rather than claiming checks you
did not run.

## Contributor checklist

- [ ] I read `CONTRIBUTING.md` and will follow `CODE_OF_CONDUCT.md`.
- [ ] This pull request is focused and links the relevant issue for a large or
      behavior-changing proposal.
- [ ] Tests and user-facing documentation cover the changed contract.
- [ ] No credentials, private data, generated local state, or unrelated files
      are included.
- [ ] I reviewed and verified any material agent-assisted changes and disclosed
      that assistance below when it helps reviewers evaluate the work.

## Notes for reviewer

Call out risks, follow-up work, generated code, material agent assistance, or
checks you could not run.
