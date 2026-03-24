import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'path';
import { lookupTheory } from '../index.js';
import type { CoreFileSystem } from '../index.js';

const THEORY = resolve(import.meta.dirname, '..', '..', '..', '..', 'theory');

// ── Helpers ──

/** Build a minimal in-memory CoreFileSystem mock for theory tests. */
function mockTheoryFs(files: Record<string, string>): CoreFileSystem {
  return {
    readFileSync(path: string, _encoding: 'utf-8'): string {
      if (!(path in files)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[path];
    },
    readdirSync(path: string, _options: { withFileTypes: true }) {
      // Return .md files from the files record that are in this directory
      const entries: Array<{ name: string; isDirectory(): boolean }> = [];
      const prefix = path.endsWith('/') || path.endsWith('\\') ? path : path + '/';
      for (const filePath of Object.keys(files)) {
        // Normalize to forward slashes for comparison
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        const normalizedPrefix = prefix.replace(/\\/g, '/');
        if (normalizedFilePath.startsWith(normalizedPrefix)) {
          const rest = normalizedFilePath.substring(normalizedPrefix.length);
          if (!rest.includes('/')) {
            entries.push({ name: rest, isDirectory: () => false });
          }
        }
      }
      return entries;
    },
    existsSync(path: string): boolean {
      return path in files;
    },
  };
}

const MOCK_DIR = '/fake/theory';

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

// ---------- Edge case tests — mock-based ----------

describe('lookupTheory — empty theory directory', () => {
  it('returns empty array when no .md files exist', () => {
    const fs = mockTheoryFs({});
    const results = lookupTheory(MOCK_DIR, 'anything', fs);
    assert.deepEqual(results, []);
  });
});

describe('lookupTheory — theory file with no headings', () => {
  it('returns empty array when file has no ## headings', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'no-headings.md')]: 'This file has no headings at all.\nJust plain text.\nNo ## anywhere.',
    });
    const results = lookupTheory(MOCK_DIR, 'plain', fs);
    assert.deepEqual(results, []);
  });
});

describe('lookupTheory — Pass 3 keyword cap at 3', () => {
  it('returns at most 3 results for keyword matches (Pass 3)', () => {
    // Create a file with many sections all containing the keyword "target"
    // but none in headings or labels, so it falls to Pass 3
    const sections = [];
    for (let i = 0; i < 6; i++) {
      sections.push(`## Section ${i}\n\nThis section mentions target in its body text.`);
    }
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'many-sections.md')]: sections.join('\n\n'),
    });
    const results = lookupTheory(MOCK_DIR, 'target', fs);
    assert.equal(results.length, 3, 'Pass 3 should cap at 3 results');
  });
});

describe('lookupTheory — empty search term', () => {
  it('returns all sections (empty string matches everything)', () => {
    // normalizeForSearch('') === '' and ''.includes('') === true
    // so empty term matches all sections in Pass 1 labels, Pass 2 headings, etc.
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'test.md')]: '## Heading\n\nSome content here.',
    });
    const results = lookupTheory(MOCK_DIR, '', fs);
    // Empty string .includes('') is true, so heading match (Pass 2) fires
    assert.ok(results.length > 0, 'Empty search term matches all headings');
  });
});

describe('lookupTheory — heading-only match (Pass 2)', () => {
  it('matches on heading text when term is not in any label', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'headings.md')]: `## Domain Theory Overview\n\nThis section discusses domains.\n\n## Roles Overview\n\nThis discusses roles.`,
    });
    // "domain theory overview" matches a heading but not a label
    const results = lookupTheory(MOCK_DIR, 'Domain Theory Overview', fs);
    assert.equal(results.length, 1);
    assert.equal(results[0].section, 'Domain Theory Overview');
    assert.ok(results[0].content.includes('discusses domains'));
  });

  it('merges sub-sections under same heading in Pass 2', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'merged.md')]: [
        '## Formal Structure',
        '',
        'Intro text.',
        '',
        '**Definition 1.1 (Domain).** A domain is...',
        '',
        'More about domains.',
        '',
        '**Proposition 1.2 (Uniqueness).** The domain is unique.',
      ].join('\n'),
    });
    // "formal structure" matches the heading — should merge all sub-sections
    const results = lookupTheory(MOCK_DIR, 'Formal Structure', fs);
    assert.equal(results.length, 1, 'Should merge all sub-sections under heading');
    assert.ok(results[0].content.includes('domain'), 'Merged content includes definition');
    assert.ok(results[0].content.includes('unique'), 'Merged content includes proposition');
  });
});

describe('lookupTheory — multiple files with same heading', () => {
  it('returns separate results from each file', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'file-a.md')]: '## Common Heading\n\nContent from file A.',
      [join(MOCK_DIR, 'file-b.md')]: '## Common Heading\n\nContent from file B.',
    });
    const results = lookupTheory(MOCK_DIR, 'Common Heading', fs);
    assert.equal(results.length, 2, 'Expected one result per file');
    const sources = results.map(r => r.source).sort();
    assert.deepEqual(sources, ['file-a.md', 'file-b.md']);
  });
});

describe('lookupTheory — label match (Pass 1)', () => {
  it('matches definition labels and returns labeled sections', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'defs.md')]: [
        '## Definitions',
        '',
        '**Definition 1.1 (Domain Theory).** A domain theory is a pair...',
        '',
        'Extended explanation of domain theory.',
        '',
        '**Definition 1.2 (World State).** A world state is...',
        '',
        'Extended explanation of world state.',
      ].join('\n'),
    });
    const results = lookupTheory(MOCK_DIR, 'Domain Theory', fs);
    // Pass 1: label match on "Domain Theory"
    assert.equal(results.length, 1);
    assert.ok(results[0].label === 'Domain Theory');
    assert.ok(results[0].content.includes('domain theory is a pair'));
  });
});

describe('lookupTheory — search term with regex metacharacters', () => {
  it('handles terms with special regex chars since .includes() is used', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'special.md')]: '## Methods\n\nThe notation f(x) = x + 1 is common.',
    });
    // Parentheses are regex metacharacters but .includes handles them fine
    const results = lookupTheory(MOCK_DIR, 'f(x)', fs);
    assert.ok(results.length > 0, 'Should find content with regex metacharacters');
  });

  it('handles brackets and dots in search terms', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'brackets.md')]: '## Types\n\nThe type P(X) denotes the powerset.',
    });
    const results = lookupTheory(MOCK_DIR, 'P(X)', fs);
    assert.ok(results.length > 0, 'Should find content with P(X)');
  });
});

describe('lookupTheory — Greek letter normalization', () => {
  it('normalizes Φ in both search term and content', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'greek.md')]: '## Methodology\n\nThe methodology Φ defines transitions.',
    });
    // Searching for "Phi" should match "Φ" in content (both normalized to "phi")
    const results = lookupTheory(MOCK_DIR, 'Phi', fs);
    assert.ok(results.length > 0, 'Phi should match Φ in content');
  });

  it('normalizes Σ to Sigma', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'sigma.md')]: '## Signatures\n\nThe signature Σ contains the sorts.',
    });
    const results = lookupTheory(MOCK_DIR, 'Sigma', fs);
    assert.ok(results.length > 0, 'Sigma should match Σ in content');
  });

  it('normalizes → to -> in search', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'arrows.md')]: '## Functions\n\nThe function f : A → B maps elements.',
    });
    const results = lookupTheory(MOCK_DIR, '->', fs);
    assert.ok(results.length > 0, '-> should match → in content');
  });
});

describe('lookupTheory — Pass 1 vs Pass 2 vs Pass 3 priority', () => {
  it('prefers label match (Pass 1) over heading match (Pass 2)', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'priority.md')]: [
        '## Step Composition',
        '',
        '**Definition 4.3 (Step Composition).** Steps are composable when...',
        '',
        'More about composition.',
      ].join('\n'),
    });
    // "Step Composition" matches both a label (Pass 1) and a heading (Pass 2)
    // Pass 1 should win
    const results = lookupTheory(MOCK_DIR, 'Step Composition', fs);
    assert.ok(results.length > 0);
    assert.ok(results[0].label === 'Step Composition', 'Pass 1 label match should take priority');
  });
});

describe('lookupTheory — section with no content after heading', () => {
  it('returns empty content for heading-only section', () => {
    const fs = mockTheoryFs({
      [join(MOCK_DIR, 'empty-section.md')]: '## Empty Section\n## Next Section\n\nSome content.',
    });
    const results = lookupTheory(MOCK_DIR, 'Empty Section', fs);
    assert.ok(results.length > 0);
    assert.equal(results[0].content, '', 'Section with no body should have empty content');
  });
});
