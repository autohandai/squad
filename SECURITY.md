# Security Policy

## Report vulnerabilities privately

Do not report a suspected vulnerability in a public issue, pull request,
discussion, screenshot, or chat transcript.

[Open a private vulnerability report](https://github.com/autohandai/squad/security/advisories/new)
through GitHub Security Advisories. If GitHub's private reporting form is not
available to you, email [igor@autohand.ai](mailto:igor@autohand.ai) with the
subject `Autohand Squad security report`. Include:

- the affected version, commit, platform, and component;
- clear reproduction steps or a minimal proof of concept;
- the impact and any conditions required to exploit it; and
- a safe way to contact you for follow-up.

Remove credentials, customer data, and unrelated personal information. If a
real secret was exposed, revoke or rotate it immediately before reporting it.

We aim to acknowledge reports within five business days and provide an initial
triage update within ten business days. Resolution time depends on severity and
complexity. Please allow time for investigation and a coordinated fix before
public disclosure.

## Scope

Security reports may include vulnerabilities in:

- the local Node bridge and Rust runtime;
- authentication, token storage, and isolated squad-member profiles;
- file, shell, network, GitHub, or permission boundaries;
- installer, update, checksum, or release-integrity paths; and
- dependencies when the issue is exploitable through Autohand Squad.

General bugs, feature requests, and setup questions belong in
[GitHub Issues](https://github.com/autohandai/squad/issues). Reports that only
describe an outdated dependency without a demonstrated impact may be handled as
normal maintenance.

## Supported versions

Security fixes are developed on `main` and, when practical, applied to the most
recent GitHub Release. Older prereleases and source snapshots are not guaranteed
to receive fixes. Upgrade to the newest available release before reporting an
issue that may already be resolved.
