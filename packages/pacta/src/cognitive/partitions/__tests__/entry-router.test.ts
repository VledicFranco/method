/**
 * Entry Router Tests — PRD 044 C-2.
 *
 * Validates routing logic: D3 actor rule, constraint detection,
 * goal detection, operational fallback, and injected classifier support.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultEntryRouter } from '../entry-router.js';
import { moduleId } from '../../algebra/module.js';

// ── Test Module IDs ─────────────────────────────────────────────

const MOD_OBSERVER = moduleId('observer');
const MOD_ACTOR = moduleId('actor');
const MOD_REASONER_ACTOR = moduleId('reasoner-actor');
const MOD_PLANNER = moduleId('planner');

// ── Default Router ──────────────────────────────────────────────

describe('DefaultEntryRouter', () => {
  const router = new DefaultEntryRouter();

  it('routes "must NOT import X" to constraint', () => {
    const result = router.route('You must NOT import lodash in this project.', MOD_OBSERVER);
    assert.strictEqual(result, 'constraint');
  });

  it('routes "your task: ..." to task', () => {
    const result = router.route('Your task is to implement the partition system.', MOD_OBSERVER);
    assert.strictEqual(result, 'task');
  });

  it('routes "file read result" to operational', () => {
    const result = router.route('file read result: contents of package.json...', MOD_OBSERVER);
    assert.strictEqual(result, 'operational');
  });

  it('routes actor source to operational regardless of content', () => {
    // Content looks like a constraint, but source is actor → operational.
    const result = router.route('You must NOT import lodash.', MOD_ACTOR);
    assert.strictEqual(result, 'operational');
  });

  it('routes reasoner-actor source to operational regardless of content', () => {
    const result = router.route('Constraint: never modify registry files.', MOD_REASONER_ACTOR);
    assert.strictEqual(result, 'operational');
  });

  it('routes content with injected classifier', () => {
    const customRouter = new DefaultEntryRouter({
      classify: (_content: string) => ({ contentType: 'goal' }),
    });

    const result = customRouter.route('some arbitrary content', MOD_PLANNER);
    assert.strictEqual(result, 'task');
  });

  it('routes non-string content by stringifying', () => {
    const result = router.route({ action: 'read', path: '/foo' }, MOD_OBSERVER);
    assert.strictEqual(result, 'operational');
  });

  it('routes "objective" to task', () => {
    const result = router.route('The main objective is to ship the feature.', MOD_OBSERVER);
    assert.strictEqual(result, 'task');
  });

  it('routes "forbidden" to constraint', () => {
    const result = router.route('Direct database access is forbidden.', MOD_OBSERVER);
    assert.strictEqual(result, 'constraint');
  });

  it('constraint takes priority over goal when both match', () => {
    // Contains both constraint and goal patterns — constraint wins.
    const result = router.route('Your task goal: you must not break the build.', MOD_OBSERVER);
    assert.strictEqual(result, 'constraint');
  });
});
