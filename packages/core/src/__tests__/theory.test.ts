import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import { lookupTheory } from '../index.js';

const THEORY = resolve(import.meta.dirname, '..', '..', '..', '..', 'theory');

// ---------- P2 — Unicode normalization ----------

describe('P2 — lookupTheory with Unicode normalization', () => {
  it('"Phi-Schema" returns F4-PHI.md content', () => {
    const results = lookupTheory(THEORY, 'Phi-Schema');
    assert.ok(results.length > 0, 'Expected at least one result for "Phi-Schema"');
    const hasF4 = results.some(r => r.source === 'F4-PHI.md');
    assert.ok(hasF4, 'Expected at least one result from F4-PHI.md');
  });

  it('"sigma" matches Sigma references via Unicode normalization', () => {
    // The theory files contain "Sigma" (from normalizing greek Sigma)
    // and also references to sigma in text. This tests that the
    // Unicode normalization of Sigma maps correctly.
    const results = lookupTheory(THEORY, 'sigma');
    assert.ok(results.length > 0, 'Expected at least one result for "sigma"');
  });

  it('"delta" matches delta references via Unicode normalization', () => {
    // The theory files contain delta (from normalizing greek delta)
    // and text references to delta. This tests Unicode normalization.
    const results = lookupTheory(THEORY, 'delta');
    assert.ok(results.length > 0, 'Expected at least one result for "delta"');
  });
});

describe('P2 — lookupTheory existing queries still work', () => {
  it('"domain retraction" returns results', () => {
    const results = lookupTheory(THEORY, 'domain retraction');
    assert.ok(results.length > 0, 'Expected results for "domain retraction"');
    // Should find content about domain retraction pairs (embed, project)
    const hasRelevant = results.some(r =>
      r.content.includes('retraction') || r.section.toLowerCase().includes('retraction')
    );
    assert.ok(hasRelevant, 'Expected results to contain retraction-related content');
  });

  it('"methodology" returns results', () => {
    const results = lookupTheory(THEORY, 'methodology');
    assert.ok(results.length > 0, 'Expected results for "methodology"');
  });

  it('"coalgebra" returns results', () => {
    const results = lookupTheory(THEORY, 'coalgebra');
    assert.ok(results.length > 0, 'Expected results for "coalgebra"');
    const hasRelevant = results.some(r =>
      r.content.toLowerCase().includes('coalgebra')
    );
    assert.ok(hasRelevant, 'Expected results to mention coalgebra');
  });
});
