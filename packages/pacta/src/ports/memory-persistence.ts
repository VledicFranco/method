// SPDX-License-Identifier: Apache-2.0
/**
 * JSONL Memory Persistence — file-backed storage for FactCards.
 *
 * Supports load, save (full rewrite), and append operations on JSONL
 * (newline-delimited JSON) files. Corrupt lines are skipped with warnings.
 *
 * Also provides Markdown export grouped by epistemic type with confidence indicators.
 */

import { readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import type { FactCard, EpistemicType } from './memory-port.js';

// ── Confidence display helpers ────────────────────────────────────

function confidenceIndicator(confidence: number): string {
  if (confidence >= 0.9) return '[*****]';
  if (confidence >= 0.7) return '[**** ]';
  if (confidence >= 0.5) return '[***  ]';
  if (confidence >= 0.3) return '[**   ]';
  return '[*    ]';
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'very high';
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.5) return 'moderate';
  if (confidence >= 0.3) return 'low';
  return 'very low';
}

// ── Epistemic type display order ──────────────────────────────────

const EPISTEMIC_ORDER: EpistemicType[] = [
  'FACT',
  'RULE',
  'PROCEDURE',
  'HEURISTIC',
  'OBSERVATION',
];

const EPISTEMIC_LABELS: Record<EpistemicType, string> = {
  FACT: 'Facts',
  RULE: 'Rules',
  PROCEDURE: 'Procedures',
  HEURISTIC: 'Heuristics',
  OBSERVATION: 'Observations',
};

// ── JsonlMemoryStore ──────────────────────────────────────────────

export class JsonlMemoryStore {
  constructor(private readonly filePath: string) {}

  /**
   * Load all FactCards from the JSONL file.
   * Corrupt lines are skipped with a warning to stderr.
   * Returns an empty array if the file does not exist.
   */
  async load(): Promise<FactCard[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const lines = raw.split('\n').filter(line => line.trim().length > 0);
    const cards: FactCard[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        // Basic shape validation
        if (
          typeof parsed.id === 'string' &&
          typeof parsed.content === 'string' &&
          typeof parsed.type === 'string' &&
          typeof parsed.confidence === 'number'
        ) {
          cards.push(parsed as FactCard);
        } else {
          warnings.push(`Line ${i + 1}: missing required FactCard fields, skipping`);
        }
      } catch {
        warnings.push(`Line ${i + 1}: invalid JSON, skipping`);
      }
    }

    if (warnings.length > 0) {
      console.warn(`[JsonlMemoryStore] ${warnings.length} corrupt line(s) in ${this.filePath}:`);
      for (const w of warnings) {
        console.warn(`  ${w}`);
      }
    }

    return cards;
  }

  /**
   * Save all FactCards to the JSONL file (full rewrite).
   * Each card is serialized as a single JSON line.
   */
  async save(cards: FactCard[]): Promise<void> {
    const content = cards.map(c => JSON.stringify(c)).join('\n') + (cards.length > 0 ? '\n' : '');
    await writeFile(this.filePath, content, 'utf-8');
  }

  /**
   * Append a single FactCard to the JSONL file.
   * Creates the file if it does not exist.
   */
  async append(card: FactCard): Promise<void> {
    // If the file exists and doesn't end with a newline, we prefix one
    let prefix = '';
    try {
      const info = await stat(this.filePath);
      if (info.size > 0) {
        const content = await readFile(this.filePath, 'utf-8');
        if (!content.endsWith('\n')) {
          prefix = '\n';
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // File doesn't exist; appendFile will create it
    }
    await appendFile(this.filePath, prefix + JSON.stringify(card) + '\n', 'utf-8');
  }

  /**
   * Export FactCards as a human-readable Markdown document.
   * Groups cards by epistemic type, sorted by confidence within each group.
   */
  exportMarkdown(cards: FactCard[]): string {
    if (cards.length === 0) {
      return '# Memory Export\n\n*No cards stored.*\n';
    }

    // Group by type
    const groups = new Map<EpistemicType, FactCard[]>();
    for (const card of cards) {
      const group = groups.get(card.type) ?? [];
      group.push(card);
      groups.set(card.type, group);
    }

    const lines: string[] = [
      '# Memory Export',
      '',
      `> ${cards.length} card(s) across ${groups.size} type(s)`,
      '',
    ];

    for (const type of EPISTEMIC_ORDER) {
      const group = groups.get(type);
      if (!group || group.length === 0) continue;

      // Sort by confidence descending
      group.sort((a, b) => b.confidence - a.confidence);

      lines.push(`## ${EPISTEMIC_LABELS[type]}`);
      lines.push('');

      for (const card of group) {
        const ci = confidenceIndicator(card.confidence);
        const cl = confidenceLabel(card.confidence);
        const date = new Date(card.created).toISOString().slice(0, 10);
        const tags = card.tags.length > 0 ? ` — tags: ${card.tags.join(', ')}` : '';
        lines.push(`- ${ci} **${card.content}**`);
        lines.push(`  _confidence: ${card.confidence.toFixed(2)} (${cl}) | created: ${date}${tags}_`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
