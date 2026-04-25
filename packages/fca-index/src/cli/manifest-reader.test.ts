// SPDX-License-Identifier: Apache-2.0
/**
 * DefaultManifestReader — unit tests covering YAML parsing for the
 * `languages` field (added in v0.4.0) and existing scalar/list fields
 * (regression coverage).
 */

import { describe, it, expect } from 'vitest';
import { DefaultManifestReader } from './manifest-reader.js';
import { InMemoryFileSystem } from '../scanner/test-helpers/in-memory-fs.js';

async function readConfig(yaml: string) {
  const fs = new InMemoryFileSystem({ '/p/.fca-index.yaml': yaml });
  const reader = new DefaultManifestReader(fs);
  return reader.read('/p');
}

describe('DefaultManifestReader — languages field', () => {
  it('parses block list form for languages', async () => {
    const config = await readConfig(
      ['languages:', '  - typescript', '  - scala'].join('\n'),
    );
    expect(config.languages).toEqual(['typescript', 'scala']);
  });

  it('parses inline flow form for languages', async () => {
    const config = await readConfig('languages: [typescript, scala]');
    expect(config.languages).toEqual(['typescript', 'scala']);
  });

  it('parses inline flow with quoted scalars', async () => {
    const config = await readConfig('languages: ["typescript", "markdown-only"]');
    expect(config.languages).toEqual(['typescript', 'markdown-only']);
  });

  it('parses inline flow with single-quoted scalars', async () => {
    const config = await readConfig("languages: ['python', 'go']");
    expect(config.languages).toEqual(['python', 'go']);
  });

  it('handles empty inline flow list', async () => {
    const config = await readConfig('languages: []');
    expect(config.languages).toEqual([]);
  });

  it('omits languages when not present in YAML', async () => {
    const config = await readConfig('coverageThreshold: 0.9');
    expect(config.languages).toBeUndefined();
    expect(config.coverageThreshold).toBe(0.9);
  });

  it('preserves order of profile names in block form', async () => {
    const config = await readConfig(
      ['languages:', '  - scala', '  - python', '  - typescript'].join('\n'),
    );
    expect(config.languages).toEqual(['scala', 'python', 'typescript']);
  });

  it('coexists with other fields in any order', async () => {
    const config = await readConfig(
      [
        'coverageThreshold: 0.85',
        'languages:',
        '  - typescript',
        '  - scala',
        'embeddingModel: voyage-3-lite',
      ].join('\n'),
    );
    expect(config.languages).toEqual(['typescript', 'scala']);
    expect(config.coverageThreshold).toBe(0.85);
    expect(config.embeddingModel).toBe('voyage-3-lite');
  });

  it('returns minimal config when .fca-index.yaml is missing', async () => {
    const fs = new InMemoryFileSystem({});
    const reader = new DefaultManifestReader(fs);
    const config = await reader.read('/p');
    expect(config).toEqual({ projectRoot: '/p' });
  });
});

describe('DefaultManifestReader — regression for existing fields', () => {
  it('parses scalar fields', async () => {
    const config = await readConfig(
      [
        'coverageThreshold: 0.9',
        'embeddingModel: voyage-3-lite',
        'embeddingDimensions: 512',
        'indexDir: .my-index',
      ].join('\n'),
    );
    expect(config.coverageThreshold).toBe(0.9);
    expect(config.embeddingModel).toBe('voyage-3-lite');
    expect(config.embeddingDimensions).toBe(512);
    expect(config.indexDir).toBe('.my-index');
  });

  it('parses sourcePatterns/excludePatterns block lists', async () => {
    const config = await readConfig(
      [
        'sourcePatterns:',
        '  - src/**',
        '  - lib/**',
        'excludePatterns:',
        '  - dist/**',
      ].join('\n'),
    );
    expect(config.sourcePatterns).toEqual(['src/**', 'lib/**']);
    expect(config.excludePatterns).toEqual(['dist/**']);
  });

  it('parses requiredParts as FcaPart strings', async () => {
    const config = await readConfig(
      ['requiredParts:', '  - interface', '  - documentation', '  - port'].join('\n'),
    );
    expect(config.requiredParts).toEqual(['interface', 'documentation', 'port']);
  });
});
