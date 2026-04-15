// ── PRD 010: Auto-Retrospective Generator ──────────────────────
// Synthesizes a minimal retrospective from PTY watcher observations
// when a session terminates. Writes to .method/retros/.

import { join } from 'node:path';
import type { FileSystemProvider } from '../ports/file-system.js';

/** Observation record produced by the PTY watcher (PRD 010). Retained for auto-retro after PTY removal. */
export interface ActivityObservation {
  timestamp: string;
  category: string;
  detail: Record<string, unknown>;
}

export interface AutoRetroInput {
  sessionId: string;
  nickname: string;
  observations: ActivityObservation[];
  spawnedAt: Date;
  terminatedAt: Date;
  terminationReason: 'completed' | 'killed' | 'stale' | 'exited';
  projectRoot: string;   // original project root (pre-worktree)
  /** PRD 024 MG-1: FileSystem port — injected by composition root */
  fs?: FileSystemProvider;
}

export interface AutoRetroResult {
  written: boolean;
  path: string | null;
  reason?: string;
}

/**
 * Generate and write an auto-retrospective YAML file.
 * Best-effort — failure is non-fatal.
 */
export function generateAutoRetro(input: AutoRetroInput): AutoRetroResult {
  const fs = input.fs;
  const retrosDir = join(input.projectRoot, '.method', 'retros');

  // Skip if .method/retros/ doesn't exist (project may not use method system)
  if (fs ? !fs.existsSync(retrosDir) : false) {
    return { written: false, path: null, reason: 'retros directory not found' };
  }
  // Fallback for when fs port is not provided (backward compat)
  if (!fs) {
    return { written: false, path: null, reason: 'FileSystemProvider not available' };
  }

  try {
    const filename = nextRetroFilename(retrosDir, fs);
    const filepath = join(retrosDir, filename);
    const yaml = buildRetroYaml(input);

    fs.writeFileSync(filepath, yaml, { encoding: 'utf-8' });
    return { written: true, path: filepath };
  } catch (e) {
    return { written: false, path: null, reason: (e as Error).message };
  }
}

/**
 * Compute the next retro filename: retro-YYYY-MM-DD-NNN.yaml
 */
function nextRetroFilename(retrosDir: string, fs: FileSystemProvider): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const datePrefix = `${y}-${m}-${d}`;
  const pattern = new RegExp(`^retro-${datePrefix}-(\\d{3})\\.yaml$`);

  let maxSeq = 0;
  try {
    const files = fs.readdirSync(retrosDir);
    for (const f of files) {
      const match = pattern.exec(f);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  } catch {
    // Directory read failure — start at 001
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `retro-${datePrefix}-${nextSeq}.yaml`;
}

/**
 * Build the retro YAML content from observations.
 */
function buildRetroYaml(input: AutoRetroInput): string {
  const { sessionId, nickname, observations, spawnedAt, terminatedAt, terminationReason } = input;
  const generatedAt = new Date().toISOString();

  // Timing
  const durationMs = terminatedAt.getTime() - spawnedAt.getTime();
  const durationMinutes = Math.round(durationMs / 60_000);

  // Activity analysis
  const toolCalls = observations.filter(o => o.category === 'tool_call');
  const idlePeriods = observations.filter(o => o.category === 'idle');
  const fileOps = observations.filter(o => o.category === 'file_operation');
  const gitCommits = observations.filter(o => o.category === 'git_commit');
  const testResults = observations.filter(o => o.category === 'test_result');
  const buildResults = observations.filter(o => o.category === 'build_result');
  const errors = observations.filter(o => o.category === 'error');

  // Compute active vs idle minutes
  const totalIdleSeconds = idlePeriods.reduce((sum, o) => {
    const secs = (o.detail as Record<string, number>).idle_after_seconds ?? 0;
    return sum + secs;
  }, 0);
  const idleMinutes = Math.round(totalIdleSeconds / 60);
  const activeMinutes = Math.max(0, durationMinutes - idleMinutes);

  // Tool breakdown — top tools by frequency
  const toolCounts = new Map<string, number>();
  for (const obs of toolCalls) {
    const tool = String(obs.detail.tool);
    toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
  }
  const toolBreakdown = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Unique files touched
  const filesTouched = new Set<string>();
  for (const obs of fileOps) {
    filesTouched.add(String(obs.detail.path));
  }

  // Last test result
  const lastTest = testResults.length > 0 ? testResults[testResults.length - 1] : null;
  const lastBuild = buildResults.length > 0 ? buildResults[buildResults.length - 1] : null;

  // Build YAML
  const lines: string[] = [
    '# Auto-generated retrospective — PTY activity detection (PRD 010)',
    '# This is a machine-observed retro, not an agent-authored one.',
    '',
    'retro:',
    `  session_id: "${esc(sessionId)}"`,
    `  nickname: "${esc(nickname)}"`,
    '  generated_by: pty-watcher',
    `  generated_at: "${generatedAt}"`,
    '',
    '  timing:',
    `    spawned_at: "${spawnedAt.toISOString()}"`,
    `    terminated_at: "${terminatedAt.toISOString()}"`,
    `    duration_minutes: ${durationMinutes}`,
    `    active_minutes: ${activeMinutes}`,
    `    idle_minutes: ${idleMinutes}`,
    `    termination_reason: "${terminationReason}"`,
    '',
    '  activity_summary:',
    `    tool_calls: ${toolCalls.length}`,
  ];

  // Tool breakdown
  if (toolBreakdown.length > 0) {
    lines.push('    tool_breakdown:');
    for (const [tool, count] of toolBreakdown) {
      lines.push(`      - tool: ${tool}`);
      lines.push(`        count: ${count}`);
    }
  } else {
    lines.push('    tool_breakdown: []');
  }

  // Files touched
  if (filesTouched.size > 0) {
    lines.push('    files_touched:');
    for (const f of [...filesTouched].slice(0, 30)) {
      lines.push(`      - ${esc(f)}`);
    }
  } else {
    lines.push('    files_touched: []');
  }

  // Git commits
  if (gitCommits.length > 0) {
    lines.push('    git_commits:');
    for (const obs of gitCommits) {
      lines.push(`      - hash: ${esc(String(obs.detail.hash))}`);
      lines.push(`        message: "${esc(String(obs.detail.message))}"`,);
    }
  } else {
    lines.push('    git_commits: []');
  }

  // Quality section
  lines.push('');
  lines.push('  quality:');
  lines.push(`    tests_run: ${lastTest ? 'true' : 'false'}`);
  if (lastTest) {
    lines.push('    last_test_result:');
    lines.push(`      total: ${lastTest.detail.total ?? 0}`);
    lines.push(`      passed: ${lastTest.detail.passed ?? 0}`);
    lines.push(`      failed: ${lastTest.detail.failed ?? 0}`);
  }
  lines.push(`    build_succeeded: ${lastBuild ? String(lastBuild.detail.success ?? false) : 'null'}`);
  lines.push(`    errors_observed: ${errors.length}`);

  // Placeholder sections
  lines.push('');
  lines.push('  hardest_decision: "(auto-generated — not available)"');
  lines.push('  observations:');
  lines.push('    - "Machine-observed activity profile. See activity_summary for details."');
  lines.push('  card_feedback:');
  lines.push('    essence_feedback: "(auto-generated — not available)"');
  lines.push('');

  return lines.join('\n');
}

/** Escape YAML string content */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
