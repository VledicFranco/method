// SPDX-License-Identifier: Apache-2.0
/**
 * Refinement Engine — Per-build and cross-build analysis for the Build Orchestrator.
 *
 * Produces refinements (observations + proposals) from pipeline execution data,
 * and aggregates refinements across builds to surface recurring patterns.
 *
 * @see PRD 047 — Build Orchestrator §Evidence & Refinement
 */

import { join } from 'node:path';

import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';
import type { FeatureSpec } from '../../ports/checkpoint.js';
import type { PhaseResult, Refinement, EvidenceReport } from './types.js';
import type { BuildConfig } from './config.js';

// ── Per-Build Analysis ─────────────────────────────────────────

/**
 * Analyze a single build's phase results and produce refinements.
 *
 * Heuristics:
 * 1. If any phase took > 50% of total duration → propose optimization for that phase
 * 2. If any failure recovery happened → analyze what gate failed, propose improvement
 * 3. If validator couldn't evaluate a criterion (stub types) → propose expanding validator
 * 4. If orchestrator cost > 15% of total → propose prompt optimization
 */
export function produceRefinements(
  phases: readonly PhaseResult[],
  featureSpec: FeatureSpec,
  options?: {
    orchestratorCost?: { tokens: number; usd: number };
    totalCost?: { tokens: number; usd: number };
  },
): Refinement[] {
  const refinements: Refinement[] = [];

  const totalDurationMs = phases.reduce((sum, p) => sum + p.durationMs, 0);

  // Heuristic 1: Slow phases (> 50% of total duration)
  if (totalDurationMs > 0) {
    for (const phase of phases) {
      const ratio = phase.durationMs / totalDurationMs;
      if (ratio > 0.5) {
        refinements.push({
          target: 'strategy',
          observation: `Phase "${phase.phase}" consumed ${(ratio * 100).toFixed(0)}% of total build duration (${phase.durationMs}ms of ${totalDurationMs}ms).`,
          proposal: `Optimize strategy for phase "${phase.phase}" — consider splitting into sub-phases, parallelizing steps, or reducing scope.`,
          evidence: `Phase "${phase.phase}": ${phase.durationMs}ms / ${totalDurationMs}ms total = ${(ratio * 100).toFixed(1)}%`,
        });
      }
    }
  }

  // Heuristic 2: Failure recovery
  for (const phase of phases) {
    if (phase.retries > 0) {
      refinements.push({
        target: 'gate',
        observation: `Phase "${phase.phase}" required ${phase.retries} retry(ies) before completion.${phase.failureContext ? ` Context: ${phase.failureContext}` : ''}`,
        proposal: `Improve gate criteria or strategy for phase "${phase.phase}" to reduce failure rate.`,
        evidence: `Phase "${phase.phase}": ${phase.retries} retries, status: ${phase.status}`,
      });
    }
  }

  // Heuristic 3: Stub/custom criteria (validator gaps)
  for (const criterion of featureSpec.criteria) {
    if (criterion.type === 'custom') {
      refinements.push({
        target: 'bridge',
        observation: `Criterion "${criterion.name}" uses type "custom" which requires manual evaluation.`,
        proposal: `Expand validator to support automated evaluation for criterion "${criterion.name}".`,
        evidence: `Criterion type: custom, check: "${criterion.check}"`,
      });
    }
  }

  // Heuristic 4: Orchestrator overhead
  if (options?.orchestratorCost && options?.totalCost && options.totalCost.usd > 0) {
    const overheadPercent = (options.orchestratorCost.usd / options.totalCost.usd) * 100;
    if (overheadPercent > 15) {
      refinements.push({
        target: 'orchestrator',
        observation: `Orchestrator cost was ${overheadPercent.toFixed(1)}% of total build cost ($${options.orchestratorCost.usd.toFixed(2)} of $${options.totalCost.usd.toFixed(2)}).`,
        proposal: `Optimize orchestrator prompts to reduce token usage — consider more concise system prompts or fewer reasoning turns.`,
        evidence: `Orchestrator: $${options.orchestratorCost.usd.toFixed(2)}, Total: $${options.totalCost.usd.toFixed(2)}, Overhead: ${overheadPercent.toFixed(1)}%`,
      });
    }
  }

  return refinements;
}

// ── Cross-Build Aggregation ────────────────────────────────────

/**
 * Aggregate refinements across multiple builds to surface recurring patterns.
 *
 * Reads past EvidenceReports from `.method/retros/retro-build-*.yaml`,
 * deduplicates by exact proposal string match, counts frequency,
 * and surfaces refinements exceeding the configured thresholds.
 */
export async function aggregateRefinements(
  retrosDir: string,
  config: Pick<BuildConfig, 'refinementFrequencyThreshold' | 'refinementConfidenceThreshold'>,
  ports?: { fs: FileSystemProvider; yaml: YamlLoader },
): Promise<Refinement[]> {
  const reports = await loadEvidenceReports(retrosDir, ports);
  return aggregateFromReports(reports, config);
}

/**
 * Pure aggregation logic — testable without filesystem.
 */
export function aggregateFromReports(
  reports: readonly EvidenceReport[],
  config: Pick<BuildConfig, 'refinementFrequencyThreshold' | 'refinementConfidenceThreshold'>,
): Refinement[] {
  // Collect all refinements
  const allRefinements: Refinement[] = [];
  for (const report of reports) {
    allRefinements.push(...report.refinements);
  }

  // Deduplicate by exact proposal string match and count frequency
  const proposalMap = new Map<string, { refinement: Refinement; count: number }>();
  for (const r of allRefinements) {
    const existing = proposalMap.get(r.proposal);
    if (existing) {
      existing.count += 1;
    } else {
      proposalMap.set(r.proposal, { refinement: r, count: 1 });
    }
  }

  // Filter by frequency threshold and minimum confidence
  const threshold = config.refinementFrequencyThreshold;
  const confidenceThreshold = config.refinementConfidenceThreshold;

  const results: Refinement[] = [];
  for (const [, { refinement, count }] of proposalMap) {
    if (count >= threshold) {
      // Derive confidence from frequency relative to total report count
      const confidence = reports.length > 0 ? count / reports.length : 0;
      if (confidence >= confidenceThreshold) {
        results.push({
          ...refinement,
          frequency: count,
        });
      }
    }
  }

  // Sort by frequency descending
  results.sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0));

  return results;
}

// ── File system helpers ────────────────────────────────────────

async function loadEvidenceReports(
  retrosDir: string,
  ports?: { fs: FileSystemProvider; yaml: YamlLoader },
): Promise<EvidenceReport[]> {
  const reports: EvidenceReport[] = [];
  try {
    let files: string[];
    if (ports) {
      files = ports.fs.readdirSync(retrosDir);
    } else {
      const { readdir } = await import('node:fs/promises');
      files = await readdir(retrosDir);
    }
    const buildRetros = files.filter((f) => f.startsWith('retro-build-') && f.endsWith('.yaml'));

    for (const file of buildRetros) {
      try {
        let raw: string;
        if (ports) {
          raw = ports.fs.readFileSync(join(retrosDir, file), 'utf-8');
        } else {
          const { readFile } = await import('node:fs/promises');
          raw = await readFile(join(retrosDir, file), 'utf-8');
        }
        let parsed: unknown;
        if (ports) {
          parsed = ports.yaml.load(raw);
        } else {
          const yaml = await import('js-yaml');
          parsed = yaml.load(raw);
        }
        const report = parsed as EvidenceReport;
        if (report && report.refinements) {
          reports.push(report);
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Directory doesn't exist or read error — return empty
  }
  return reports;
}
