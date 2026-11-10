import { createHash, randomUUID } from 'node:crypto';
import { open, link, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { streamBackup, MAX_DOCUMENT_BYTES } from '@autohand/squad-portable';

// Final files appear only after every byte and checksum has been verified.
// Exclusive publication also prevents an export from replacing an existing file.
export async function writePortableFile({ manifest, readFile, outputPath, format, assertCurrent, signal }) {
  assertCurrent();
  const partial = join(dirname(outputPath), `.squad-export-${randomUUID()}.partial`);
  const output = await open(partial, 'wx', 0o600);
  let bytes = 0;
  const hash = createHash('sha256');
  try {
    for await (const chunk of streamBackup(manifest, format, readFile, { createDigest: () => {
      const fileHash = createHash('sha256');
      return { write: chunk => { fileHash.update(chunk); }, finish: () => fileHash.digest('hex') };
    } })) {
      assertCurrent(); signal?.throwIfAborted();
      const data = Buffer.from(chunk, 'utf8'); bytes += data.length;
      if (bytes > MAX_DOCUMENT_BYTES) throw Error('This backup exceeds 256 MiB. Select fewer members; nothing was truncated.');
      hash.update(data);
      let offset = 0;
      while (offset < data.length) { const written = await output.write(data, offset, data.length - offset); offset += written.bytesWritten; }
    }
    await output.sync(); await output.close();
    assertCurrent(); signal?.throwIfAborted();
    await link(partial, outputPath);
    return { path: outputPath, format, bytes, sha256: hash.digest('hex'), createdAt: manifest.createdAt, owner: manifest.owner };
  } finally { await output.close().catch(() => {}); await unlink(partial).catch(() => {}); }
}
