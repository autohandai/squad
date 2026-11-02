// The macOS permission host Squad bundles is Autohand Computer Use itself
// (autohandai/computer-use, built unmodified from its pinned source): the
// same app, the same identity `ai.autohand.computer-use`, the same consent
// text and icon that Autohand Code installs with `autohand computer install`.
// One component across the CLI, Squad and Autohand Desktop, one macOS grant
// (ADR-0162, revising ADR-0070's Squad-branded identity).
export const COMPUTER_USE_HOST = Object.freeze({
  bundleName: 'Autohand Computer Use.app',
  displayName: 'Autohand Computer Use',
  bundleId: 'ai.autohand.computer-use',
  executable: 'AutohandComputerUse',
});

/** A built host's provenance must say it is the upstream host, unpatched. */
export function verifyComputerUseBranding(branding) {
  for (const field of ['bundleId', 'displayName']) {
    if (branding?.[field] !== COMPUTER_USE_HOST[field]) throw new Error('The Computer Use host is not Autohand Computer Use; Squad ships the upstream host unmodified.');
  }
  if (branding?.patchSha256 || branding?.patched === true) throw new Error('The Computer Use host carries a source patch; Squad ships the upstream host unmodified.');
}
