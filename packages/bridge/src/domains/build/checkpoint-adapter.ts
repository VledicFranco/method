/**
 * CheckpointPort implementation — YAML-based pipeline state persistence.
 *
 * Serializes PipelineCheckpoint as YAML files under {checkpointDir}/{sessionId}/checkpoint.yaml.
 * Uses FileSystemProvider and YamlLoader ports per FCA G-PORT (no direct fs/js-yaml imports).
 *
 * @see PRD 047 — Build Orchestrator §Checkpoint
 */

import { join } from 'node:path';
import type { CheckpointPort, PipelineCheckpoint, PipelineCheckpointSummary } from '../../ports/checkpoint.js';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';

export class FileCheckpointAdapter implements CheckpointPort {
  constructor(
    private readonly checkpointDir: string,
    private readonly fs: FileSystemProvider,
    private readonly yaml: YamlLoader,
  ) {}

  async save(sessionId: string, checkpoint: PipelineCheckpoint): Promise<void> {
    const dir = join(this.checkpointDir, sessionId);
    this.fs.mkdirSync(dir, { recursive: true });
    const content = this.yaml.dump(checkpoint as unknown as Record<string, unknown>);
    this.fs.writeFileSync(join(dir, 'checkpoint.yaml'), content);
  }

  async load(sessionId: string): Promise<PipelineCheckpoint | null> {
    const filePath = join(this.checkpointDir, sessionId, 'checkpoint.yaml');
    if (!this.fs.existsSync(filePath)) {
      return null;
    }
    const content = this.fs.readFileSync(filePath, 'utf-8');
    const raw = this.yaml.load(content) as PipelineCheckpoint;
    return raw;
  }

  async list(): Promise<PipelineCheckpointSummary[]> {
    if (!this.fs.existsSync(this.checkpointDir)) {
      return [];
    }

    const entries = this.fs.readdirSync(this.checkpointDir, { withFileTypes: true });
    const summaries: PipelineCheckpointSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionId = entry.name;
      const checkpoint = await this.load(sessionId);
      if (!checkpoint) continue;

      summaries.push({
        sessionId: checkpoint.sessionId,
        phase: checkpoint.phase,
        requirement: checkpoint.featureSpec?.requirement ?? '(unknown)',
        costAccumulator: { ...checkpoint.costAccumulator },
        savedAt: checkpoint.savedAt,
      });
    }

    return summaries;
  }
}
