/**
 * LanceStore — internal vector store for FCA component embeddings.
 *
 * Stores only embedding vectors keyed by component ID.
 * Uses @lancedb/lancedb (optional dependency).
 * If the module is not available, throws IndexStoreError('LanceDB not available', 'STORE_UNAVAILABLE').
 *
 * Table schema: { id: string, vector: Float32[dimensions] }
 */

import { IndexStoreError } from '../ports/internal/index-store.js';

// Dynamic import with availability check — @lancedb/lancedb is optional
let lancedb: typeof import('@lancedb/lancedb') | null = null;
let lancedbAvailable = false;

async function getLancedb(): Promise<typeof import('@lancedb/lancedb')> {
  if (lancedb !== null) return lancedb;
  try {
    lancedb = await import('@lancedb/lancedb');
    lancedbAvailable = true;
    return lancedb;
  } catch {
    lancedbAvailable = false;
    throw new IndexStoreError('LanceDB not available', 'STORE_UNAVAILABLE');
  }
}

export { lancedbAvailable };

type LanceTable = import('@lancedb/lancedb').Table;

export class LanceStore {
  private table: LanceTable | undefined;

  constructor(
    private readonly config: {
      dbPath: string;
      tableName?: string;
      dimensions: number;
    },
  ) {}

  async initialize(): Promise<void> {
    const lance = await getLancedb();
    const tableName = this.config.tableName ?? 'fca_components';
    const db = await lance.connect(this.config.dbPath);

    const existingNames = await db.tableNames();
    if (existingNames.includes(tableName)) {
      this.table = await db.openTable(tableName);
    } else {
      // Create table with a sentinel row to establish schema
      const sentinel = [
        {
          id: '__schema_init__',
          vector: Array.from({ length: this.config.dimensions }, () => 0) as number[],
        },
      ];
      this.table = await db.createTable(tableName, sentinel);
      // Remove sentinel
      await this.table.delete(`id = '__schema_init__'`);
    }
  }

  private getTable(): LanceTable {
    if (!this.table) {
      throw new IndexStoreError(
        'LanceStore not initialized — call initialize() first',
        'STORE_UNAVAILABLE',
      );
    }
    return this.table;
  }

  async upsert(id: string, embedding: number[]): Promise<void> {
    const table = this.getTable();
    // Delete existing entry if present, then insert
    await table.delete(`id = '${id.replace(/'/g, "''")}'`);
    await table.add([{ id, vector: Array.from(embedding) }]);
  }

  async querySimilar(
    queryEmbedding: number[],
    topK: number,
    ids?: string[],
  ): Promise<Array<{ id: string; score: number }>> {
    const table = this.getTable();

    const results: Record<string, unknown>[] = await table
      .search(Array.from(queryEmbedding))
      .distanceType('cosine')
      .limit(ids ? topK * 4 : topK)
      .toArray();

    let scored = results.map((row) => ({
      id: row['id'] as string,
      // Lance cosine distance is 1 - similarity; convert to similarity score
      score: 1 - (row['_distance'] as number),
    }));

    if (ids && ids.length > 0) {
      const idSet = new Set(ids);
      scored = scored.filter((r: { id: string; score: number }) => idSet.has(r.id));
    }

    scored.sort((a: { id: string; score: number }, b: { id: string; score: number }) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const table = this.getTable();
    const quoted = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    await table.delete(`id IN (${quoted})`);
  }
}
