/**
 * SqliteStore — internal metadata store for FCA component entries.
 *
 * Stores all IndexEntry fields except the embedding vector.
 * Uses better-sqlite3 (synchronous API).
 *
 * Schema:
 *   fca_components(id, project_root, path, level, parts JSON, coverage_score, indexed_at)
 *   idx_project_root on (project_root)
 *   idx_coverage on (project_root, coverage_score)
 */

import type Database from 'better-sqlite3';
import type { IndexEntry, IndexQueryFilters, IndexCoverageStats } from '../ports/internal/index-store.js';
import type { FcaPart, ComponentPart } from '../ports/context-query.js';

const ALL_PARTS: FcaPart[] = [
  'interface',
  'boundary',
  'port',
  'domain',
  'architecture',
  'verification',
  'observability',
  'documentation',
];

type StoredRow = {
  id: string;
  project_root: string;
  path: string;
  level: string;
  parts: string;
  coverage_score: number;
  indexed_at: string;
};

function rowToEntry(row: StoredRow): Omit<IndexEntry, 'embedding'> {
  return {
    id: row.id,
    projectRoot: row.project_root,
    path: row.path,
    level: row.level as IndexEntry['level'],
    parts: JSON.parse(row.parts) as ComponentPart[],
    coverageScore: row.coverage_score,
    indexedAt: row.indexed_at,
  };
}

export class SqliteStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fca_components (
        id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        path TEXT NOT NULL,
        level TEXT NOT NULL,
        parts TEXT NOT NULL,
        coverage_score REAL NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_root ON fca_components(project_root);
      CREATE INDEX IF NOT EXISTS idx_coverage ON fca_components(project_root, coverage_score);
    `);
  }

  upsert(entry: Omit<IndexEntry, 'embedding'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO fca_components (id, project_root, path, level, parts, coverage_score, indexed_at)
      VALUES (@id, @project_root, @path, @level, @parts, @coverage_score, @indexed_at)
      ON CONFLICT(id) DO UPDATE SET
        project_root = excluded.project_root,
        path = excluded.path,
        level = excluded.level,
        parts = excluded.parts,
        coverage_score = excluded.coverage_score,
        indexed_at = excluded.indexed_at
    `);
    stmt.run({
      id: entry.id,
      project_root: entry.projectRoot,
      path: entry.path,
      level: entry.level,
      parts: JSON.stringify(entry.parts),
      coverage_score: entry.coverageScore,
      indexed_at: entry.indexedAt,
    });
  }

  getById(id: string): Omit<IndexEntry, 'embedding'> | undefined {
    const stmt = this.db.prepare('SELECT * FROM fca_components WHERE id = ?');
    const row = stmt.get(id) as StoredRow | undefined;
    if (!row) return undefined;
    return rowToEntry(row);
  }

  getByProjectRoot(
    projectRoot: string,
    filters?: Omit<IndexQueryFilters, 'projectRoot'>,
  ): Omit<IndexEntry, 'embedding'>[] {
    const rows = this.db
      .prepare('SELECT * FROM fca_components WHERE project_root = ? ORDER BY coverage_score DESC')
      .all(projectRoot) as StoredRow[];

    let entries = rows.map(rowToEntry);

    if (filters?.levels && filters.levels.length > 0) {
      const levelSet = new Set(filters.levels);
      entries = entries.filter((e) => levelSet.has(e.level));
    }

    if (filters?.parts && filters.parts.length > 0) {
      const wantedParts = new Set(filters.parts);
      entries = entries.filter((e) => e.parts.some((p) => wantedParts.has(p.part)));
    }

    if (filters?.minCoverageScore !== undefined) {
      entries = entries.filter((e) => e.coverageScore >= filters.minCoverageScore!);
    }

    return entries;
  }

  getCoverageStats(projectRoot: string): IndexCoverageStats {
    const entries = this.db
      .prepare('SELECT * FROM fca_components WHERE project_root = ?')
      .all(projectRoot) as StoredRow[];

    const totalComponents = entries.length;
    const weightedAverage =
      totalComponents === 0
        ? 0
        : entries.reduce((sum, r) => sum + r.coverage_score, 0) / totalComponents;

    const parsed = entries.map((r) => JSON.parse(r.parts) as ComponentPart[]);
    const byPart = {} as Record<FcaPart, number>;
    for (const part of ALL_PARTS) {
      const count = parsed.filter((parts) => parts.some((p) => p.part === part)).length;
      byPart[part] = totalComponents === 0 ? 0 : count / totalComponents;
    }

    return { totalComponents, weightedAverage, byPart };
  }

  getByPath(
    path: string,
    projectRoot: string,
  ): Omit<IndexEntry, 'embedding'> | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM fca_components WHERE project_root = ? AND path = ?',
    );
    const row = stmt.get(projectRoot, path) as StoredRow | undefined;
    if (!row) return undefined;
    return rowToEntry(row);
  }

  deleteByProjectRoot(projectRoot: string): void {
    this.db.prepare('DELETE FROM fca_components WHERE project_root = ?').run(projectRoot);
  }
}
