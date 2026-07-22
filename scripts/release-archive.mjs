import process from 'node:process';

export function tarCreateArgs(archiveName, sourceDir, bundleName, platform = process.platform) {
  return [
    '-czf',
    archiveName,
    '-C',
    platform === 'win32' ? sourceDir.replaceAll('\\', '/') : sourceDir,
    bundleName,
  ];
}
