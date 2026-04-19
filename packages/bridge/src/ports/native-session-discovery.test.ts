// SPDX-License-Identifier: Apache-2.0
/**
 * NativeSessionDiscovery port tests.
 *
 * Tests the Node implementation created by createNodeNativeSessionDiscovery.
 * Uses temporary directories and mocked process.kill for PID liveness checks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNodeNativeSessionDiscovery } from './native-session-discovery.js';

describe('NativeSessionDiscovery — createNodeNativeSessionDiscovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'native-session-discovery-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads PID files and returns sessions with live PIDs', async () => {
    // Use the current process PID — guaranteed to be alive
    const currentPid = process.pid;
    const sessionData = {
      pid: currentPid,
      sessionId: 'session-alive-1',
      cwd: '/projects/test',
      startedAt: Date.now(),
      kind: 'interactive',
    };
    writeFileSync(
      join(tempDir, 'session-alive-1.json'),
      JSON.stringify(sessionData),
    );

    const discovery = createNodeNativeSessionDiscovery(tempDir);
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'session-alive-1');
    assert.strictEqual(sessions[0].pid, currentPid);
    assert.strictEqual(sessions[0].projectPath, '/projects/test');
    assert.strictEqual(sessions[0].startedAt, sessionData.startedAt);
  });

  it('handles missing directory — returns empty array', async () => {
    const discovery = createNodeNativeSessionDiscovery(
      join(tempDir, 'nonexistent-subdir'),
    );
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 0);
  });

  it('handles corrupt JSON — skips bad files, does not throw', async () => {
    writeFileSync(join(tempDir, 'corrupt.json'), '{not valid json!!!');

    // Also add a valid file with current PID
    writeFileSync(
      join(tempDir, 'valid.json'),
      JSON.stringify({
        pid: process.pid,
        sessionId: 'valid-session',
        cwd: '/projects/valid',
        startedAt: Date.now(),
      }),
    );

    const discovery = createNodeNativeSessionDiscovery(tempDir);
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'valid-session');
  });

  it('skips JSON files missing required fields', async () => {
    // Missing sessionId
    writeFileSync(
      join(tempDir, 'incomplete.json'),
      JSON.stringify({ pid: process.pid, cwd: '/foo', startedAt: 123 }),
    );

    const discovery = createNodeNativeSessionDiscovery(tempDir);
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 0);
  });

  it('filters out sessions with dead PIDs', async () => {
    // PID 999999999 is extremely unlikely to be alive
    const deadPid = 999999999;
    writeFileSync(
      join(tempDir, 'dead-session.json'),
      JSON.stringify({
        pid: deadPid,
        sessionId: 'dead-session',
        cwd: '/projects/dead',
        startedAt: Date.now() - 10000,
      }),
    );

    // Alive session (current process)
    writeFileSync(
      join(tempDir, 'alive-session.json'),
      JSON.stringify({
        pid: process.pid,
        sessionId: 'alive-session',
        cwd: '/projects/alive',
        startedAt: Date.now(),
      }),
    );

    const discovery = createNodeNativeSessionDiscovery(tempDir);
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'alive-session');
  });

  it('ignores non-JSON files in the directory', async () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'not a json file');
    writeFileSync(join(tempDir, 'data.yaml'), 'key: value');

    const discovery = createNodeNativeSessionDiscovery(tempDir);
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 0);
  });

  it('handles empty directory', async () => {
    const emptyDir = join(tempDir, 'empty');
    mkdirSync(emptyDir);

    const discovery = createNodeNativeSessionDiscovery(emptyDir);
    const sessions = await discovery.listLiveSessions();

    assert.strictEqual(sessions.length, 0);
  });
});
