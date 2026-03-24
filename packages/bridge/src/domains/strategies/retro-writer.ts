/**
 * PRD 017: Strategy Pipelines — Retrospective Writer
 *
 * Filesystem operations for saving strategy retrospectives.
 * Split from retro-generator.ts per DR-03: pure logic lives in @method/core,
 * I/O operations stay in @method/bridge.
 */

import { join } from 'node:path';
import { NodeFileSystemProvider, type FileSystemProvider } from '../../ports/file-system.js';
import { retroToYaml } from './retro-generator.js';
import type { StrategyRetro } from './retro-generator.js';

// PRD 024 MG-1: Module-level fs port, set via setRetroWriterFs()
let _fs: FileSystemProvider | null = null;

/** PRD 024: Configure FileSystemProvider for retro-writer. Called from composition root. */
export function setRetroWriterFs(fs: FileSystemProvider): void {
  _fs = fs;
}

function getFs(): FileSystemProvider {
  if (!_fs) _fs = new NodeFileSystemProvider();
  return _fs;
}

/**
 * Save a retrospective to disk.
 * Filename: retro-strategy-YYYY-MM-DD-NNN.yaml
 * Returns the full file path.
 */
export async function saveRetro(
  retro: StrategyRetro,
  retroDir: string,
): Promise<string> {
  const fs = getFs();
  // Ensure directory exists
  await fs.mkdir(retroDir, { recursive: true });

  // Determine sequence number for today
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `retro-strategy-${today}-`;

  let maxSeq = 0;
  try {
    const files = await fs.readdir(retroDir);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.yaml')) {
        const seqStr = file.slice(prefix.length, -5); // Remove prefix and .yaml
        const seq = parseInt(seqStr, 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  } catch {
    // Directory may not have any files yet — that's fine
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  const filename = `${prefix}${nextSeq}.yaml`;
  const filePath = join(retroDir, filename);

  const yamlContent = retroToYaml(retro);
  await fs.writeFile(filePath, yamlContent, 'utf-8');

  return filePath;
}
