#!/usr/bin/env node
// Compose the GitHub release body for a version:
//
//   1. the channel banner (Stable / Beta / Nightly) and the source commit,
//   2. "What's new": the CHANGELOG.md section for this version, or the
//      Unreleased section for nightly builds,
//   3. a download table linking every installer in the release,
//   4. install, verify (checksums), and update instructions.
//
//   node scripts/release-notes.mjs --version 0.2.0 --channel stable \
//     --assets release/publish --source-sha <sha> --out release/release-notes.md
//
// The publish job passes the file to `gh release create --notes-file` together
// with `--generate-notes`, so the categorised pull-request list follows it.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const version = required('version');
const channel = args.channel || 'stable';
const tag = args.tag || `v${version}`;
const repository = args.repository || 'autohandai/squad';
const assetsDir = args.assets || '';
const sourceSha = args['source-sha'] || '';
const changelogPath = args.changelog || 'CHANGELOG.md';
const out = args.out || '';

const changelog = await readFile(changelogPath, 'utf8').catch(() => '');
const assets = assetsDir ? (await readdir(assetsDir).catch(() => [])).sort() : [];
const body = renderNotes({ version, channel, tag, repository, sourceSha, changelog, assets });

if (out) {
  await writeFile(out, body);
  console.log(`Wrote release notes to ${out}`);
} else {
  process.stdout.write(body);
}

export function renderNotes({ version, channel, tag, repository, sourceSha, changelog, assets }) {
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  const lines = [];
  const banner = {
    stable: '**Stable release.** Recommended for everyone.',
    beta: '**Beta.** Feature-complete build for early adopters; report anything odd.',
    canary: '**Nightly build.** Built automatically from `main`; expect rough edges. Stable users are not offered nightly builds.',
  }[channel] || `**${channel} release.**`;
  lines.push(banner);
  if (sourceSha) lines.push(`Source: [\`${sourceSha.slice(0, 12)}\`](https://github.com/${repository}/commit/${sourceSha})`);
  lines.push('');

  const section = changelogSection(changelog, channel === 'canary' ? 'Unreleased' : version);
  lines.push("## What's new", '');
  lines.push(section || (channel === 'canary' ? 'See the commit list below.' : '_No changelog entry for this version._'));
  lines.push('');

  const downloads = downloadRows(assets, base);
  if (downloads.length) {
    lines.push('## Downloads', '', '| Platform | Download |', '| --- | --- |', ...downloads, '');
  }

  lines.push(
    '## Install',
    '',
    '- **macOS:** open the DMG and drag Autohand Squad to Applications. Apple Silicon and Intel builds are separate.',
    '- **Windows:** run the setup EXE; it installs for the current user and fetches WebView2 if it is missing.',
    '- **Linux:** `sudo apt install ./autohand-squad-*.deb`, or make the AppImage executable and run it.',
    '- **Headless / servers:** the portable `.tar.gz` runs `bin/squad` with a system Node 18.17+.',
    '',
    '## Verify',
    '',
    `Every asset is listed in [\`checksums.txt\`](${base}/checksums.txt): \`shasum -a 256 -c checksums.txt\` (macOS/Linux) or \`Get-FileHash\` (Windows).`,
    '',
    '## Updating',
    '',
    'Installed apps check this repository for their channel (Settings → Updates, or the tray). Stable follows releases, beta follows pre-releases, canary follows nightly builds.',
    '',
  );
  return lines.join('\n');
}

export function changelogSection(text, heading) {
  if (!text) return '';
  const wanted = heading.toLowerCase();
  const lines = text.split(/\r?\n/);
  let collecting = false;
  const body = [];
  for (const line of lines) {
    const match = line.match(/^## \[?([^\]]+?)\]?(?:\s+-\s+.*)?$/);
    if (match) {
      if (collecting) break;
      collecting = match[1].trim().toLowerCase() === wanted;
      continue;
    }
    if (collecting) body.push(line);
  }
  const trimmed = body.join('\n').trim();
  return trimmed;
}

export function downloadRows(assets, base) {
  const rows = [];
  const find = (test) => assets.find((name) => test(name.toLowerCase()));
  const add = (label, name) => {
    if (name) rows.push(`| ${label} | [\`${name}\`](${base}/${name}) |`);
  };
  add('macOS Apple Silicon', find((n) => n.endsWith('.dmg') && (n.includes('arm64') || n.includes('aarch64'))));
  add('macOS Intel', find((n) => n.endsWith('.dmg') && n.includes('x64') && !n.includes('arm64')));
  add('Windows x64', find((n) => n.endsWith('-setup.exe')));
  add('Linux x64 (Debian/Ubuntu)', find((n) => n.endsWith('.deb')));
  add('Linux x64 (AppImage)', find((n) => n.endsWith('.appimage')));
  for (const name of assets.filter((n) => n.toLowerCase().endsWith('.tar.gz') && !n.includes('-web-'))) {
    const target = name.replace(/^autohand-squad-[^-]+-/, '').replace(/\.tar\.gz$/, '');
    add(`Portable ${target}`, name);
  }
  return rows;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function required(name) {
  const value = String(args[name] || '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
