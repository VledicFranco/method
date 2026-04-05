import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderError,
  TransientError,
  PermanentError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  AuthError,
  InvalidRequestError,
  CliExecutionError,
  CliSpawnError,
  CliAbortError,
  isProviderError,
  isTransientError,
  isPermanentError,
  redactCredentials,
} from './errors.js';

const CLI_CTX = { providerClass: 'claude-cli' as const };
const API_CTX = { providerClass: 'anthropic-api' as const };

describe('redactCredentials', () => {
  it('redacts sk-ant-* API keys', () => {
    assert.equal(
      redactCredentials('auth failed for sk-ant-api03-abcdef1234'),
      'auth failed for sk-ant-[REDACTED]',
    );
  });

  it('redacts JWT tokens', () => {
    assert.equal(
      redactCredentials('token eyJhbGciOiJIUzI.eyJzdWIiOiIx.SflKxwRJSM'),
      'token [JWT-REDACTED]',
    );
  });

  it('redacts Bearer tokens', () => {
    assert.equal(
      redactCredentials('Authorization: Bearer sk-secret-123'),
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('handles multiple patterns in one string', () => {
    const input = 'key=sk-ant-api03-xyz Bearer tok123';
    const result = redactCredentials(input);
    assert.ok(!result.includes('sk-ant-api03-xyz'));
    assert.ok(!result.includes('tok123'));
  });

  it('passes through clean strings unchanged', () => {
    assert.equal(redactCredentials('no secrets here'), 'no secrets here');
  });
});

describe('isProviderError / isTransientError / isPermanentError', () => {
  it('isProviderError returns true for transient subclasses', () => {
    const err = new RateLimitError(CLI_CTX);
    assert.ok(isProviderError(err));
  });

  it('isProviderError returns true for permanent subclasses', () => {
    const err = new AuthError(API_CTX);
    assert.ok(isProviderError(err));
  });

  it('isProviderError returns false for plain Error', () => {
    assert.ok(!isProviderError(new Error('nope')));
  });

  it('isProviderError returns false for non-object', () => {
    assert.ok(!isProviderError('string'));
    assert.ok(!isProviderError(null));
    assert.ok(!isProviderError(undefined));
    assert.ok(!isProviderError(42));
  });

  it('isTransientError discriminates correctly', () => {
    assert.ok(isTransientError(new RateLimitError(CLI_CTX)));
    assert.ok(isTransientError(new NetworkError(CLI_CTX)));
    assert.ok(isTransientError(new TimeoutError({ ...CLI_CTX, timeoutMs: 5000 })));
    assert.ok(!isTransientError(new AuthError(CLI_CTX)));
    assert.ok(!isTransientError(new CliExecutionError({ ...CLI_CTX, exitCode: 1, stderr: '' })));
  });

  it('isPermanentError discriminates correctly', () => {
    assert.ok(isPermanentError(new AuthError(API_CTX)));
    assert.ok(isPermanentError(new InvalidRequestError(API_CTX)));
    assert.ok(isPermanentError(new CliExecutionError({ ...CLI_CTX, exitCode: 1, stderr: '' })));
    assert.ok(isPermanentError(new CliSpawnError({ ...CLI_CTX, binary: 'claude', cause: new Error() })));
    assert.ok(isPermanentError(new CliAbortError(CLI_CTX)));
    assert.ok(!isPermanentError(new RateLimitError(CLI_CTX)));
  });
});

describe('ProviderError hierarchy', () => {
  it('instanceof chain works for RateLimitError', () => {
    const err = new RateLimitError(CLI_CTX);
    assert.ok(err instanceof RateLimitError);
    assert.ok(err instanceof TransientError);
    assert.ok(err instanceof ProviderError);
    assert.ok(err instanceof Error);
  });

  it('instanceof chain works for AuthError', () => {
    const err = new AuthError(API_CTX);
    assert.ok(err instanceof AuthError);
    assert.ok(err instanceof PermanentError);
    assert.ok(err instanceof ProviderError);
    assert.ok(err instanceof Error);
  });

  it('kind discriminator is correct', () => {
    assert.equal(new RateLimitError(CLI_CTX).kind, 'transient');
    assert.equal(new NetworkError(CLI_CTX).kind, 'transient');
    assert.equal(new TimeoutError({ ...CLI_CTX, timeoutMs: 1000 }).kind, 'transient');
    assert.equal(new AuthError(CLI_CTX).kind, 'permanent');
    assert.equal(new InvalidRequestError(CLI_CTX).kind, 'permanent');
    assert.equal(new CliExecutionError({ ...CLI_CTX, exitCode: 1, stderr: '' }).kind, 'permanent');
    assert.equal(new CliSpawnError({ ...CLI_CTX, binary: 'x', cause: null }).kind, 'permanent');
    assert.equal(new CliAbortError(CLI_CTX).kind, 'permanent');
  });
});

describe('concrete subclass properties', () => {
  it('RateLimitError carries retryAfterMs', () => {
    const err = new RateLimitError({ ...CLI_CTX, retryAfterMs: 5000 });
    assert.equal(err.retryAfterMs, 5000);
    assert.equal(err.code, 'RATE_LIMIT');
    assert.equal(err.name, 'RateLimitError');
  });

  it('TimeoutError carries timeoutMs', () => {
    const err = new TimeoutError({ ...CLI_CTX, timeoutMs: 30000 });
    assert.equal(err.timeoutMs, 30000);
    assert.equal(err.code, 'TIMEOUT');
    assert.ok(err.message.includes('30000'));
  });

  it('CliExecutionError carries exitCode and stderr', () => {
    const err = new CliExecutionError({
      ...CLI_CTX,
      exitCode: 1,
      stderr: 'something went wrong with sk-ant-api03-secret',
    });
    assert.equal(err.exitCode, 1);
    assert.ok(!err.stderr.includes('sk-ant-api03-secret'), 'stderr should be redacted');
    assert.ok(err.stderr.includes('sk-ant-[REDACTED]'));
    assert.equal(err.code, 'CLI_EXECUTION');
  });

  it('CliSpawnError carries binary', () => {
    const cause = new Error('ENOENT');
    const err = new CliSpawnError({ ...CLI_CTX, binary: '/usr/bin/claude', cause });
    assert.equal(err.binary, '/usr/bin/claude');
    assert.equal(err.code, 'CLI_SPAWN');
    assert.equal(err.cause, cause);
  });

  it('CliAbortError has correct code', () => {
    const err = new CliAbortError(CLI_CTX);
    assert.equal(err.code, 'CLI_ABORT');
    assert.equal(err.name, 'CliAbortError');
  });

  it('NetworkError defaults message', () => {
    const err = new NetworkError(API_CTX);
    assert.ok(err.message.includes('Network error'));
    assert.equal(err.code, 'NETWORK');
  });

  it('InvalidRequestError defaults message', () => {
    const err = new InvalidRequestError(API_CTX);
    assert.ok(err.message.includes('Invalid request'));
    assert.equal(err.code, 'INVALID_REQUEST');
  });
});

describe('toJSON()', () => {
  it('excludes stack trace', () => {
    const err = new RateLimitError({ ...CLI_CTX, retryAfterMs: 3000 });
    const json = err.toJSON();
    assert.equal(json.name, 'RateLimitError');
    assert.equal(json.kind, 'transient');
    assert.equal(json.code, 'RATE_LIMIT');
    assert.equal(json.providerClass, 'claude-cli');
    assert.equal(json.retryAfterMs, 3000);
    assert.equal(json.message, 'Rate limit exceeded');
    assert.ok(!('stack' in json), 'stack must not appear in toJSON');
  });

  it('PermanentError toJSON has correct shape', () => {
    const err = new AuthError({ ...API_CTX, message: 'bad key' });
    const json = err.toJSON();
    assert.equal(json.kind, 'permanent');
    assert.equal(json.code, 'AUTH');
    assert.equal(json.providerClass, 'anthropic-api');
  });
});

describe('credential redaction at construction', () => {
  it('redacts API key in error message', () => {
    const err = new AuthError({
      ...API_CTX,
      message: 'Invalid key: sk-ant-api03-secret123abc',
    });
    assert.ok(!err.message.includes('sk-ant-api03-secret123abc'));
    assert.ok(err.message.includes('sk-ant-[REDACTED]'));
  });

  it('CliExecutionError redacts both message and stderr', () => {
    const stderr = 'Error: bad key sk-ant-api03-xyz and Bearer token123';
    const err = new CliExecutionError({ ...CLI_CTX, exitCode: 1, stderr });
    assert.ok(!err.message.includes('sk-ant-api03-xyz'));
    assert.ok(!err.stderr.includes('sk-ant-api03-xyz'));
  });
});

describe('providerClass and accountId', () => {
  it('carries providerClass from context', () => {
    assert.equal(new RateLimitError(CLI_CTX).providerClass, 'claude-cli');
    assert.equal(new AuthError(API_CTX).providerClass, 'anthropic-api');
  });

  it('carries optional accountId', () => {
    const err = new RateLimitError({
      ...CLI_CTX,
      accountId: 'max-a' as import('@method/types').AccountId,
    });
    assert.equal(err.accountId, 'max-a');
  });

  it('accountId is undefined when not provided', () => {
    assert.equal(new RateLimitError(CLI_CTX).accountId, undefined);
  });
});
