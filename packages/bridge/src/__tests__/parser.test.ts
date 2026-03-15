import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractResponse } from '../parser.js';

describe('extractResponse', () => {
  it('extracts basic response between ● and ❯', () => {
    const buffer = 'some preamble\n● Here is the response text.\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Here is the response text.');
  });

  it('strips ANSI escape sequences from the response', () => {
    const buffer = '● \x1b[1mBold text\x1b[0m and \x1b[32mgreen text\x1b[0m\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Bold text and green text');
  });

  it('replaces cursor-right escapes with spaces', () => {
    const buffer = '● Hello\x1b[1CWorld\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Hello World');
  });

  it('simulates carriage return overwriting', () => {
    const buffer = '● Loading...\rDone!    \n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Done!');
  });

  it('uses fallback extraction when no ● marker is present', () => {
    const buffer = 'Just some output without a marker\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Just some output without a marker');
  });

  it('returns empty string when buffer has no readable content', () => {
    const buffer = '\n\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, '');
  });

  it('uses the last ● marker when multiple are present', () => {
    const buffer = '● First response\n❯ more stuff\n● Second response\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Second response');
  });

  it('filters out box-drawing / TUI chrome lines', () => {
    const buffer = '● ┌──────────────┐\nActual content\n└──────────────┘\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Actual content');
  });

  it('filters out pure whitespace lines', () => {
    const buffer = '●\n   \n  Real content here  \n   \n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Real content here');
  });

  it('handles multiline response correctly', () => {
    const buffer = '● Line one\nLine two\nLine three\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Line one\nLine two\nLine three');
  });

  it('handles mixed ANSI + carriage return + box-drawing', () => {
    const buffer = [
      'preamble\n',
      '● \x1b[1mHeader\x1b[0m\n',
      '├──────┤\n',
      'Content line\rOverwritten line\n',
      '  \n',
      '└──────┘\n',
      '❯ ',
    ].join('');
    const result = extractResponse(buffer);
    assert.equal(result, 'Header\nOverwritten line');
  });

  it('handles buffer with no ❯ — takes everything after last ●', () => {
    const buffer = '● Response without prompt end';
    const result = extractResponse(buffer);
    assert.equal(result, 'Response without prompt end');
  });

  it('handles ❯ appearing mid-line', () => {
    const buffer = '● Some text❯ rest ignored';
    const result = extractResponse(buffer);
    assert.equal(result, 'Some text');
  });

  it('handles empty response between ● and ❯', () => {
    const buffer = '●\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, '');
  });

  it('handles complex ANSI sequences in response', () => {
    const buffer = '● \x1b[38;5;214mOrange\x1b[0m \x1b[48;2;0;128;0mGreenBg\x1b[0m\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Orange GreenBg');
  });

  it('preserves content with special characters', () => {
    const buffer = '● Code: `const x = 42;` and path: /usr/bin/env\n❯ ';
    const result = extractResponse(buffer);
    assert.equal(result, 'Code: `const x = 42;` and path: /usr/bin/env');
  });
});
