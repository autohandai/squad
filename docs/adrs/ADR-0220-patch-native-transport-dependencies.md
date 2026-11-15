# ADR-0220: Patch the locked native transport dependencies

## Context and evidence

The repository's open Dependabot alerts on 13 November 2026 identify eight
Rustls findings across the daemon and desktop lockfiles, plus a high-severity
Quinn stream-reassembly finding in the daemon. The locked versions were Rustls
0.23.40 and 0.23.45 respectively, and daemon quinn-proto 0.11.14. The desktop
already resolved quinn-proto 0.11.18 and does not need downgrading.

The upstream [Rustls advisory](https://github.com/rustls/rustls/security/advisories/GHSA-c8m5-c952-6cm4)
and repository alert metadata identify 0.23.46 as the patched Rustls release.
The upstream [Quinn advisory](https://github.com/quinn-rs/quinn/security/advisories/GHSA-4w2j-m93h-cj5j)
identifies quinn-proto 0.11.15 as patched for unbounded reassembly memory use.

## Decision

Update Rustls to 0.23.46 in both lockfiles and daemon quinn-proto to 0.11.15.
Preserve existing compatible dependencies where possible. Rustls 0.23.46 requires
aws-lc-rs 1.18 and rustls-webpki 0.103.14 or later: the daemon advances to
aws-lc-rs 1.18.1, its aws-lc-sys 0.45.0 dependency and rustls-webpki 0.103.16.
The desktop already has compatible versions. Manifest ranges, transport features,
provider settings and application behavior stay unchanged.

The first Cargo update selected aws-lc-rs 1.19.0. Pinning the daemon's update to
the compatible 1.18.1 already used by the desktop reduces unrelated native
crypto/build changes while meeting the new Rustls requirement. An unrelated
tempfile getrandom resolution change was removed; locked checks verify the
retained graph remains valid.

## Consequences and verification

This targets nine transport alerts; their actual GitHub closure must be checked
after merging. It does not assert that Squad exercised every vulnerable path,
nor replace upstream security testing. Native compilation and the repository's
serial Rust test command validate the selected graph against Squad. The initial
default-parallel library run failed an update-admission test; the documented
command in CONTRIBUTING.md and docs/release.md requires `--test-threads=1`.
That serial run passed 110 library and two binary tests. The first desktop
check stopped at missing sidecars in the fresh worktree; after staging current
runtime binaries and standalone Node 22.23.4, the locked desktop check passed on
macOS ARM with Rust 1.90.0. Local staging is separate from signed release proof.

Two glib 0.18.5 alerts remain in the GTK3 dependency graph. The
[upstream advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
specifies glib 0.20.0 as patched, while the locked GTK3 crates require 0.18.
That is a separate native compatibility/backport decision, not a compatible
lockfile substitution. These alerts are not dismissed or represented as fixed.
No application UI or standing design rule changes in this update.
