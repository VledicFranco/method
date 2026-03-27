/**
 * FactCardStore — JSONL file-backed persistence for FactCards.
 *
 * Wraps an InMemoryMemory and adds load/save lifecycle:
 * - load(path): reads JSONL file, populates memory
 * - save(path): writes all cards to JSONL file
 * - exportMarkdown(path): renders cards as readable markdown
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { InMemoryMemory } from '../ports/memory-impl.js';
import type { FactCard, MemoryPortV2 } from '../ports/memory-port.js';

export class FactCardStore {
  private memory: InMemoryMemory;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.memory = new InMemoryMemory();
  }

  /** Get the underlying MemoryPortV2 for use in cognitive modules. */
  get port(): MemoryPortV2 { return this.memory; }

  /** Load FactCards from JSONL file. Merges with any existing cards. */
  async load(): Promise<number> {
    if (!existsSync(this.filePath)) return 0;
    const content = readFileSync(this.filePath, 'utf8');
    let count = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const card = JSON.parse(line) as FactCard;
        await this.memory.storeCard(card);
        count++;
      } catch { /* skip malformed lines */ }
    }
    return count;
  }

  /** Save all FactCards to JSONL file. Overwrites existing file. */
  async save(): Promise<number> {
    const cards = await this.memory.allCards();
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const lines = cards.map(c => JSON.stringify(c)).join('\n');
    writeFileSync(this.filePath, lines + '\n', 'utf8');
    return cards.length;
  }

  /** Export all FactCards as readable markdown, grouped by type. */
  async exportMarkdown(outputPath: string): Promise<void> {
    const cards = await this.memory.allCards();
    const byType = new Map<string, FactCard[]>();
    for (const card of cards) {
      const list = byType.get(card.type) ?? [];
      list.push(card);
      byType.set(card.type, list);
    }

    const lines: string[] = ['# Cognitive Agent Memory\n'];
    lines.push(`Total cards: ${cards.length}\n`);
    lines.push(`Exported: ${new Date().toISOString()}\n`);

    for (const type of ['RULE', 'FACT', 'HEURISTIC', 'OBSERVATION']) {
      const typeCards = byType.get(type) ?? [];
      if (typeCards.length === 0) continue;
      lines.push(`\n## ${type} (${typeCards.length})\n`);
      // Sort by confidence descending
      typeCards.sort((a, b) => b.confidence - a.confidence);
      for (const card of typeCards) {
        lines.push(`### ${card.id}`);
        lines.push(`- **Content:** ${card.content}`);
        lines.push(`- **Confidence:** ${card.confidence.toFixed(2)}`);
        lines.push(`- **Tags:** ${card.tags.join(', ') || '(none)'}`);
        lines.push(`- **Source:** ${JSON.stringify(card.source)}`);
        lines.push(`- **Created:** ${new Date(card.created).toISOString()}`);
        if (card.links.length > 0) {
          lines.push(`- **Links:** ${card.links.join(', ')}`);
        }
        lines.push('');
      }
    }

    const dir = dirname(outputPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outputPath, lines.join('\n'), 'utf8');
  }

  /** Get count of stored cards. */
  async count(): Promise<number> {
    return (await this.memory.allCards()).length;
  }
}
