import process from 'node:process';

export function tarCreateArgs(archivePath, bundleName, platform = process.platform) {
  return [
    ...(platform === 'win32' ? ['--force-local'] : []),
    '-czf',
    archivePath,
    bundleName,
  ];
}
