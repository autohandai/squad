#!/usr/bin/env node
// ADR-0248: every staging script resolves one signing identity, and a
// release-signed Computer Use host must carry the release team, the hardened
// runtime and a timestamp. Pure checks; no keychain, no codesign.
import assert from 'node:assert/strict';
import { assertReleaseSignature, identityTeam, parseCodesignDisplay, releaseSigningIdentity } from './lib/macos-signing.mjs';
import { developerIdRequirement } from './verify-macos-signature.mjs';

const RELEASE = 'Developer ID Application: Fixture Ltd (ABCDE12345)';

assert.equal(releaseSigningIdentity({}), '-', 'no identity is ad-hoc');
assert.equal(releaseSigningIdentity({ APPLE_SIGNING_IDENTITY: RELEASE }), RELEASE, 'what prepare-apple-signing exports is honoured by every stager');
assert.equal(releaseSigningIdentity({ APPLE_SIGNING_IDENTITY: RELEASE, AUTOHAND_CODESIGN_IDENTITY: '-' }), '-', 'an explicit ad-hoc request wins');
assert.equal(releaseSigningIdentity({ AUTOHAND_CODESIGN_IDENTITY: '  ', APPLE_SIGNING_IDENTITY: RELEASE }), RELEASE, 'blank is unset');
assert.equal(identityTeam(RELEASE), 'ABCDE12345');
assert.equal(identityTeam('-'), null);
assert.equal(identityTeam('0123456789ABCDEF0123456789ABCDEF01234567'), null, 'a certificate hash names no team');

// Shapes copied from `codesign -dvvv` on the 0.1.22 canary DMG's host and the
// portable archive's host (17 Nov 2026).
const developerId = parseCodesignDisplay(`Executable=/x/AutohandComputerUse
Identifier=ai.autohand.computer-use
CodeDirectory v=20500 size=420 flags=0x10000(runtime) hashes=6+3 location=embedded
Authority=Developer ID Application: Fixture Ltd (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=16 Nov 2026 at 4:24:51 PM
TeamIdentifier=ABCDE12345
Runtime Version=26.5.0`);
assert.deepEqual(developerId, { identifier: 'ai.autohand.computer-use', adhoc: false, teamId: 'ABCDE12345', developerId: true, hardenedRuntime: true, timestamped: true });
const adhoc = parseCodesignDisplay(`Identifier=ai.autohand.computer-use
CodeDirectory v=20500 size=409 flags=0x10002(adhoc,runtime) hashes=6+3 location=embedded
Signature=adhoc
TeamIdentifier=not set`);
assert.equal(adhoc.adhoc, true);
assert.equal(adhoc.teamId, null);

assert.doesNotThrow(() => assertReleaseSignature(developerId, RELEASE, 'host'));
assert.doesNotThrow(() => assertReleaseSignature(adhoc, '-', 'host'), 'local ad-hoc builds stay valid');
assert.throws(() => assertReleaseSignature(adhoc, RELEASE, 'host'), /ad-hoc although team ABCDE12345/);
assert.throws(() => assertReleaseSignature(adhoc, '0123456789ABCDEF0123456789ABCDEF01234567', 'host'), /ad-hoc although a signing identity/);
assert.throws(() => assertReleaseSignature(developerId, 'Developer ID Application: Other (ZZZZZ99999)', 'host'), /team ABCDE12345, not ZZZZZ99999/);
assert.throws(() => assertReleaseSignature({ ...developerId, hardenedRuntime: false }, RELEASE, 'host'), /hardened runtime/);
assert.throws(() => assertReleaseSignature({ ...developerId, timestamped: false }, RELEASE, 'host'), /timestamp/);

// The requirement checked is the one codesign printed as the designated
// requirement of the CLI-installed and DMG copies.
assert.equal(developerIdRequirement('ABCDE12345'), 'identifier "ai.autohand.computer-use" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = ABCDE12345');

console.log('Nested signing check passed: one identity resolver, release team/runtime/timestamp enforced, ad-hoc local builds allowed.');
