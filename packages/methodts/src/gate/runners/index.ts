// SPDX-License-Identifier: Apache-2.0
/**
 * gate/runners/ — Concrete gate runner implementations.
 *
 * scriptGate: runs shell command, passes if exit 0.
 * testRunner: runs project test suite, passes if all pass.
 * httpChecker: HTTP health check, passes if 2xx response.
 * checklistGate: human-in-the-loop attestation checklist.
 * callbackGate: arbitrary async callback for custom gate logic.
 */

export * from './script-gate.js';
export * from './test-runner.js';
export * from './http-checker.js';
export * from './checklist-gate.js';
export * from './callback-gate.js';
