// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { createBridgeToolProvider } from '../runtime-tools.js';

describe('Edit tool (PRD 040 C-1)', () => {
  let tmpDir: string;
  let provider: ReturnType<typeof createBridgeToolProvider>;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `bridge-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    provider = createBridgeToolProvider(tmpDir);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  });

  it('replaces a unique string in a file (AC-08)', async () => {
    const filePath = join(tmpDir, 'test.txt');
    writeFileSync(filePath, 'hello world', 'utf-8');

    const result = await provider.execute('Edit', {
      path: 'test.txt',
      old_string: 'hello',
      new_string: 'goodbye',
    });

    assert.equal(result.output, 'Edit applied successfully');
    assert.equal(result.isError, undefined);
    assert.equal(readFileSync(filePath, 'utf-8'), 'goodbye world');
  });

  it('returns error when old_string is not found', async () => {
    const filePath = join(tmpDir, 'test.txt');
    writeFileSync(filePath, 'hello world', 'utf-8');

    const result = await provider.execute('Edit', {
      path: 'test.txt',
      old_string: 'nonexistent',
      new_string: 'replacement',
    });

    assert.equal(result.output, 'String not found in file');
    assert.equal(result.isError, true);
    // File should be unchanged
    assert.equal(readFileSync(filePath, 'utf-8'), 'hello world');
  });

  it('returns error when old_string appears multiple times (ambiguous)', async () => {
    const filePath = join(tmpDir, 'test.txt');
    writeFileSync(filePath, 'foo bar foo baz foo', 'utf-8');

    const result = await provider.execute('Edit', {
      path: 'test.txt',
      old_string: 'foo',
      new_string: 'qux',
    });

    assert.equal(result.output, 'Ambiguous: string appears 3 times. Provide more context to make it unique.');
    assert.equal(result.isError, true);
    // File should be unchanged
    assert.equal(readFileSync(filePath, 'utf-8'), 'foo bar foo baz foo');
  });

  it('blocks path traversal (same security as Read/Write)', async () => {
    const result = await provider.execute('Edit', {
      path: '../../../etc/passwd',
      old_string: 'root',
      new_string: 'hacked',
    });

    assert.equal(result.isError, true);
    assert.ok((result.output as string).includes('Path outside workdir not allowed'));
  });

  it('handles multi-line old_string and new_string', async () => {
    const filePath = join(tmpDir, 'multi.txt');
    const original = 'line one\nline two\nline three\nline four\n';
    writeFileSync(filePath, original, 'utf-8');

    const result = await provider.execute('Edit', {
      path: 'multi.txt',
      old_string: 'line two\nline three',
      new_string: 'replaced line A\nreplaced line B\nreplaced line C',
    });

    assert.equal(result.output, 'Edit applied successfully');
    assert.equal(result.isError, undefined);
    assert.equal(
      readFileSync(filePath, 'utf-8'),
      'line one\nreplaced line A\nreplaced line B\nreplaced line C\nline four\n',
    );
  });
});
