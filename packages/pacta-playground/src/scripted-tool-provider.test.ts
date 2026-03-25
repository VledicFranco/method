import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptedToolProvider } from './scripted-tool-provider.js';

describe('ScriptedToolProvider', () => {
  it('returns scripted result when matcher matches', async () => {
    const provider = new ScriptedToolProvider();
    provider
      .addTool({ name: 'Read' })
      .given('Read', (input: unknown) => {
        const p = input as { file_path?: string };
        return p.file_path === '/test.ts';
      })
      .thenReturn({ output: 'file content here' });

    const result = await provider.execute('Read', { file_path: '/test.ts' });
    assert.equal(result.output, 'file content here');
    assert.equal(result.isError, undefined);
  });

  it('returns error when no rule matches', async () => {
    const provider = new ScriptedToolProvider();
    provider.addTool({ name: 'Read' });

    const result = await provider.execute('Read', { file_path: '/unknown.ts' });
    assert.equal(result.isError, true);
    assert.ok((result.output as string).includes('no matching rule'));
  });

  it('givenAny matches any input', async () => {
    const provider = new ScriptedToolProvider();
    provider
      .addTool({ name: 'Grep' })
      .givenAny('Grep')
      .thenReturn({ output: 'found something' });

    const result = await provider.execute('Grep', { pattern: 'anything' });
    assert.equal(result.output, 'found something');
  });

  it('uses first matching rule', async () => {
    const provider = new ScriptedToolProvider();
    provider
      .addTool({ name: 'Read' })
      .given('Read', (input: unknown) => {
        const p = input as { file_path?: string };
        return p.file_path === '/specific.ts';
      })
      .thenReturn({ output: 'specific' })
      .given('Read', () => true)
      .thenReturn({ output: 'fallback' });

    const r1 = await provider.execute('Read', { file_path: '/specific.ts' });
    assert.equal(r1.output, 'specific');

    const r2 = await provider.execute('Read', { file_path: '/other.ts' });
    assert.equal(r2.output, 'fallback');
  });

  it('records calls in callLog', async () => {
    const provider = new ScriptedToolProvider();
    provider
      .addTool({ name: 'Write' })
      .givenAny('Write')
      .thenReturn({ output: 'ok' });

    await provider.execute('Write', { file_path: '/a.ts', content: 'hello' });
    assert.equal(provider.callLog.length, 1);
    assert.equal(provider.callLog[0].name, 'Write');
    assert.deepEqual(provider.callLog[0].input, { file_path: '/a.ts', content: 'hello' });
  });

  it('list() returns registered tools', () => {
    const provider = new ScriptedToolProvider();
    provider.addTool({ name: 'Read' }).addTool({ name: 'Grep' });
    const names = provider.list().map(t => t.name);
    assert.deepEqual(names, ['Read', 'Grep']);
  });

  it('rules property returns all registered rules', () => {
    const provider = new ScriptedToolProvider();
    provider
      .givenAny('Read').thenReturn({ output: 'a' })
      .givenAny('Write').thenReturn({ output: 'b' });
    assert.equal(provider.rules.length, 2);
    assert.equal(provider.rules[0].toolName, 'Read');
    assert.equal(provider.rules[1].toolName, 'Write');
  });
});
