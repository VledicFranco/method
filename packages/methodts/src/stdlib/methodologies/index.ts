/**
 * stdlib/methodologies/ — Canonical P-series Methodology<S> definitions.
 *
 * Import individual methodology files directly — arm names may collide across
 * methodologies so `export *` from all files is not safe here.
 *
 * P1-EXEC: single-arm execution with gate validation.
 * P2-SD: software development (plan → implement → review → refine).
 * P3-GOV: governance — council facilitation and decision approval.
 * P3-DISP: dispatch — task decomposition + parallel agent coordination.
 * P-GH: GitHub operations (triage, review, implementation, PR).
 */

export type {} from './p1-exec.js';
