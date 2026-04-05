/**
 * Gate unit tests — uses real Peggy for compilation and parsing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import peggy from 'peggy';
import {
  createPeggyCompileGate,
  createPeggyParseGate,
  createSchemaGate,
} from '../gates.js';
import type { PipelineContext } from '../types.js';

const baseContext: PipelineContext = {
  runId: 'test-run',
  pipelineId: 'test-pipeline',
  originalInput: '',
  metadata: {},
  state: new Map(),
};

// ── Known-good grammar from seed data ────────────────────────

const SIMPLE_GRAMMAR = `
RawSpec
  = data:DataSection EOL title:TitleSection EOL length:LengthSection EOLopt
    { return { data: data, title: title, length: length }; }

DataSection
  = "DATA:" _ v:Bool { return v; }

TitleSection
  = "TITLE:" _ v:Float { return v; }

LengthSection
  = "LENGTH:" _ v:Bool { return v; }

Bool = "yes" { return true; } / "no" { return false; }
QuotedString = '"' chars:$[^"]* '"' { return chars; }
Float = chars:$([0-9]+ ("." [0-9]+)?) { return parseFloat(chars); }
_ = [ \\t]*
EOL = _ "\\n"
EOLopt = (_ "\\n")?
`.trim();

const VALID_DSL = 'DATA: yes\nTITLE: 42.0\nLENGTH: no';
const INVALID_DSL = 'INVALID STUFF HERE';

// ── PeggyCompileGate ─────────────────────────────────────────

describe('PeggyCompileGate', () => {
  const gate = createPeggyCompileGate();

  it('passes for a valid grammar', async () => {
    const result = await gate.validate({ data: SIMPLE_GRAMMAR, context: baseContext });
    assert.equal(result.pass, true);
    assert.equal(result.validatedData, SIMPLE_GRAMMAR);
  });

  it('stores compiled parser in stateUpdates', async () => {
    const result = await gate.validate({ data: SIMPLE_GRAMMAR, context: baseContext });
    assert.ok(result.stateUpdates);
    const parser = result.stateUpdates.get('compiledParser');
    assert.ok(parser, 'compiledParser should be in stateUpdates');
    // Verify it's a usable parser
    const parsed = (parser as peggy.Parser).parse(VALID_DSL);
    assert.deepEqual(parsed, { data: true, title: 42.0, length: false });
  });

  it('fails for an invalid grammar', async () => {
    const result = await gate.validate({
      data: 'not a grammar {{{{',
      context: baseContext,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reason?.includes('Grammar compilation failed'));
  });

  it('fails for empty grammar', async () => {
    const result = await gate.validate({ data: '', context: baseContext });
    assert.equal(result.pass, false);
  });

  it('uses custom state key', async () => {
    const gate2 = createPeggyCompileGate('custom-gate', 'myParser');
    const result = await gate2.validate({ data: SIMPLE_GRAMMAR, context: baseContext });
    assert.ok(result.stateUpdates?.has('myParser'));
  });
});

// ── PeggyParseGate ───────────────────────────────────────────

describe('PeggyParseGate', () => {
  const compiledParser = peggy.generate(SIMPLE_GRAMMAR);

  const gate = createPeggyParseGate(
    'parse-gate',
    (ctx) => ctx.state.get('compiledParser') as peggy.Parser,
  );

  const contextWithParser: PipelineContext = {
    ...baseContext,
    state: new Map([['compiledParser', compiledParser]]),
  };

  it('passes for valid DSL input', async () => {
    const result = await gate.validate({
      data: VALID_DSL,
      context: contextWithParser,
    });
    assert.equal(result.pass, true);
    assert.deepEqual(result.validatedData, { data: true, title: 42.0, length: false });
  });

  it('fails for invalid DSL input', async () => {
    const result = await gate.validate({
      data: INVALID_DSL,
      context: contextWithParser,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reason?.includes('Parse failed'));
  });

  it('fails when parser is not in context', async () => {
    const result = await gate.validate({
      data: VALID_DSL,
      context: baseContext, // no parser in state
    });
    assert.equal(result.pass, false);
    assert.ok(result.reason?.includes('Could not retrieve parser'));
  });
});

// ── SchemaGate ───────────────────────────────────────────────

describe('SchemaGate', () => {
  const gate = createSchemaGate('schema-gate', {
    data: 'boolean',
    title: 'number',
    length: 'boolean',
  });

  it('passes for matching schema', async () => {
    const result = await gate.validate({
      data: JSON.stringify({ data: true, title: 42, length: false }),
      context: baseContext,
    });
    assert.equal(result.pass, true);
  });

  it('fails for missing field', async () => {
    const result = await gate.validate({
      data: JSON.stringify({ data: true, title: 42 }),
      context: baseContext,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reason?.includes('Missing required field: length'));
  });

  it('fails for wrong type', async () => {
    const result = await gate.validate({
      data: JSON.stringify({ data: true, title: 'wrong', length: false }),
      context: baseContext,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reason?.includes('expected number, got string'));
  });

  it('allows optional fields with undefined type', async () => {
    const optGate = createSchemaGate('opt-gate', {
      required: 'string',
      optional: ['string', 'undefined'],
    });
    const result = await optGate.validate({
      data: JSON.stringify({ required: 'hello' }),
      context: baseContext,
    });
    assert.equal(result.pass, true);
  });

  it('fails for non-JSON input', async () => {
    const result = await gate.validate({
      data: 'not json',
      context: baseContext,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reason?.includes('not valid JSON'));
  });
});
