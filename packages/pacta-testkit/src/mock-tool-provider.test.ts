// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockToolProvider } from './mock-tool-provider.js';

describe('MockToolProvider', () => {
  let provider: MockToolProvider;

  beforeEach(() => {
    provider = new MockToolProvider();
  });

  it('lists registered tools', () => {
    provider.addTool({ name: 'Read', description: 'Read a file' });
    provider.addTool({ name: 'Grep', description: 'Search files' });

    const tools = provider.list();
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'Read');
    assert.equal(tools[1].name, 'Grep');
  });

  it('returns scripted responses in order', async () => {
    provider.addTool(
      { name: 'Read' },
      { output: 'file-content-1' },
      { output: 'file-content-2' },
    );

    const r1 = await provider.execute('Read', { path: '/a' });
    const r2 = await provider.execute('Read', { path: '/b' });

    assert.equal(r1.output, 'file-content-1');
    assert.equal(r2.output, 'file-content-2');
  });

  it('records call log', async () => {
    provider.addTool({ name: 'Bash' }, { output: 'ok' });
    await provider.execute('Bash', { command: 'ls' });

    assert.equal(provider.callLog.length, 1);
    assert.equal(provider.callLog[0].name, 'Bash');
    assert.deepEqual(provider.callLog[0].input, { command: 'ls' });
  });

  it('throws on unknown tool', async () => {
    await assert.rejects(
      () => provider.execute('Unknown', {}),
      /unknown tool 'Unknown'/,
    );
  });

  it('throws when responses exhausted', async () => {
    provider.addTool({ name: 'Read' }, { output: 'once' });
    await provider.execute('Read', {});

    await assert.rejects(
      () => provider.execute('Read', {}),
      /no remaining responses for tool 'Read'/,
    );
  });

  it('can return error results', async () => {
    provider.addTool(
      { name: 'Bash' },
      { output: 'command not found', isError: true },
    );

    const result = await provider.execute('Bash', { command: 'bad' });
    assert.equal(result.isError, true);
    assert.equal(result.output, 'command not found');
  });

  it('reset clears tools and call log', async () => {
    provider.addTool({ name: 'Read' }, { output: 'x' });
    await provider.execute('Read', {});

    provider.reset();

    assert.equal(provider.list().length, 0);
    assert.equal(provider.callLog.length, 0);
  });
});
