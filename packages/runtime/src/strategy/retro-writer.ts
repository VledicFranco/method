/**
 * PRD 017: Strategy Pipelines — Retrospective Writer
 *
 * Filesystem operations for saving strategy retrospectives. The runtime accepts
 * a FileSystemProvider via injection (no Node-specific impl bound here).
 *
 * Per DR-03: pure logic + injected ports live in runtime; the concrete
 * NodeFileSystemProvider stays in @method/bridge.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @method/bridge/domains/strategies/.
 *   - Module-level fs port pattern preserved (retain setRetroWriterFs() API).
 *   - Default fallback removed (NodeFileSystemProvider lives in bridge).
 *     Callers MUST configure the fs port at composition time.
 */

import { join } from 'node:path';
import type { FileSystemProvider } from '../ports/file-system.js';
import { retroToYaml } from './retro-generator.js';
import type { StrategyRetro } from './retro-generator.js';

// Module-level fs port, set via setRetroWriterFs()
let _fs: FileSystemProvider | null = null;

/** Configure FileSystemProvider for retro-writer. Called from composition root. */
export function setRetroWriterFs(fs: FileSystemProvider): void {
  _fs = fs;
}

function getFs(): FileSystemProvider {
  if (!_fs) {
    throw new Error(
      'retro-writer: FileSystemProvider not configured — call setRetroWriterFs() from the composition root before saveRetro().',
    );
  }
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
