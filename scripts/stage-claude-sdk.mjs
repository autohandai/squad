import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Use the person's detected CLI. Ship the SDK library and licence, without
// substituting its optional bundled native CLI for that selected executable.
export async function stageClaudeSdk(modulesRoot, runtimeDir) {
  const source = join(modulesRoot, '@anthropic-ai', 'claude-agent-sdk');
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.version !== '0.3.296') throw new Error(`Expected Claude Agent SDK 0.3.296; found ${metadata.version}`);
  const parent = join(runtimeDir, 'node_modules', '@anthropic-ai');
  await mkdir(parent, { recursive: true });
  await cp(source, join(parent, 'claude-agent-sdk'), { recursive: true, dereference: true });
}
