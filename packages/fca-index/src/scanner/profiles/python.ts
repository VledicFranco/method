// SPDX-License-Identifier: Apache-2.0
/**
 * Python LanguageProfile — detects FCA parts in Python projects.
 *
 * Detection rules:
 *   - `README.md` / `*.md` (excluding test markdown), `README.rst` → documentation
 *   - `test_*.py`, `*_test.py`, `tests.py`, `conftest.py` → verification
 *   - `architecture.py`, `arch.py` → architecture
 *   - `*_metrics.py`, `metrics.py`, `observability.py`, `telemetry.py`
 *      → observability
 *   - `*_port.py`, `port.py`, `ports.py` → port
 *   - `*_domain.py`, `domain.py` → domain
 *   - `__init__.py` (with any `class`, `def`, or `from`/`import` exports)
 *      → interface
 *
 * Subdirectory rules: `ports`, `observability`, `arch`, `domain`.
 *
 * L3 markers: `pyproject.toml`, `setup.py`, `setup.cfg`.
 *
 * Component qualification: directory contains `__init__.py` OR ≥ 2 source
 * files (`.py` / `.pyi`).
 *
 * Doc extraction: module-level docstring (`"""..."""` or `'''...'''`) at the
 * top of the file. Interface excerpt: top-level `def`, `class`, `from`/`import`
 * lines.
 */

import type { LanguageProfile } from './types.js';

const MAX_EXCERPT = 600;

export const pythonProfile: LanguageProfile = {
  name: 'python',
  sourceExtensions: ['.py', '.pyi'],
  packageMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg'],
  filePatterns: [
    // Documentation
    { pattern: /^README\.md$/, part: 'documentation' },
    { pattern: /^README\.rst$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.md$).*\.md$/, part: 'documentation' },
    // Verification — pytest + unittest conventions
    { pattern: /^conftest\.py$/, part: 'verification' },
    { pattern: /^tests\.py$/, part: 'verification' },
    { pattern: /^test_.+\.py$/, part: 'verification' },
    { pattern: /_test\.py$/, part: 'verification' },
    // Architecture
    { pattern: /^architecture\.py$/, part: 'architecture' },
    { pattern: /^arch\.py$/, part: 'architecture' },
    // Observability
    { pattern: /^metrics\.py$/, part: 'observability' },
    { pattern: /_metrics\.py$/, part: 'observability' },
    { pattern: /^observability\.py$/, part: 'observability' },
    { pattern: /^telemetry\.py$/, part: 'observability' },
    // Port — *_port.py / port.py / ports.py
    { pattern: /^port\.py$/, part: 'port' },
    { pattern: /^ports\.py$/, part: 'port' },
    { pattern: /_port\.py$/, part: 'port' },
    // Domain
    { pattern: /^domain\.py$/, part: 'domain' },
    { pattern: /_domain\.py$/, part: 'domain' },
    // Interface — __init__.py is treated as the package's public surface
    { pattern: /^__init__\.py$/, part: 'interface' },
  ],
  subdirPatterns: {
    ports: 'port',
    observability: 'observability',
    arch: 'architecture',
    domain: 'domain',
  },
  componentRule: {
    interfaceFile: '__init__.py',
    minSourceFiles: 2,
  },
  extractInterfaceExcerpt(content) {
    // Top-level `def`, `class`, `from … import`, `import` lines.
    const lines = content.split('\n');
    const sigLines: string[] = [];
    for (const line of lines) {
      if (/^(def|class|from\s+\S+\s+import|import\s+\S+|__all__\s*=)/.test(line)) {
        sigLines.push(line);
      }
    }
    if (sigLines.length === 0) {
      return content.slice(0, MAX_EXCERPT).trimEnd();
    }
    return sigLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  },
  extractDocBlock(content) {
    // Module-level docstring — leading """...""" or '''...'''
    const trimmed = content.replace(/^(?:#![^\n]*\n)?(?:\s*)/, '');
    const tripleDouble = trimmed.match(/^"""([\s\S]*?)"""/);
    if (tripleDouble) return tripleDouble[0].slice(0, MAX_EXCERPT).trimEnd();
    const tripleSingle = trimmed.match(/^'''([\s\S]*?)'''/);
    if (tripleSingle) return tripleSingle[0].slice(0, MAX_EXCERPT).trimEnd();
    return '';
  },
};
