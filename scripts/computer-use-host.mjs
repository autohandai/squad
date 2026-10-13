// Squad owns its permission identity. Upstream execution remains pinned; this
// reviewed patch changes only the host identity, display name and consent text.
export const COMPUTER_USE_HOST = Object.freeze({
  bundleName: 'Squad Computer Use.app',
  displayName: 'Squad Computer Use',
  bundleId: 'ai.autohand.squad.computer-use',
  executable: 'AutohandComputerUse',
  patchPath: 'scripts/computer-use-squad-branding.patch',
  patchSha256: '1beed4288409b5f2a6143453aa9c645aece207f5ec97ceefd32531a0377e784f',
  patchedSourceSha256: 'ab65142131d73ccfc69e315c48359dd63f0c8d0bfd80681fa909052cb7d62491',
  patchedBuildScriptSha256: '9332214d3d81dade74a500b722e84596f2b331f0c1ef4941a726ee5070079882',
  iconPath: 'src-tauri/icons/icon.png',
  iconSha256: 'fbe8aedafd646c34baf94d8e70a023c44eba40a69b13fc91fd658653e45dc53d',
});

export function verifyComputerUseBranding(branding) {
  for (const field of ['bundleId', 'displayName', 'patchSha256', 'patchedSourceSha256', 'patchedBuildScriptSha256', 'iconSha256']) {
    if (branding?.[field] !== COMPUTER_USE_HOST[field]) throw new Error('Squad Computer Use host has unverified branding provenance.');
  }
}
