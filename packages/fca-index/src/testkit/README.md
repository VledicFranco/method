# Testkit — @method/fca-index/testkit

Test doubles for the external ports of `@method/fca-index`. Import from the testkit subpackage — these are not included in the production bundle.

```typescript
import { RecordingContextQueryPort, RecordingCoverageReportPort } from '@method/fca-index/testkit';
```

**Purpose:** Enable `@method/mcp` tests (and any other port consumers) to test their handlers without standing up a real index. The recording ports stub return values and record all calls for assertion.

**When NOT to use:** If you are testing `@method/fca-index` internals, use `InMemoryIndexStore` directly — it gives you control over the stored data. The testkit is for consumers of the external ports, not for testing the library itself.

---

## RecordingContextQueryPort

A test double for `ContextQueryPort`. Returns configurable stub results and records every call.

### Constructor

```typescript
new RecordingContextQueryPort(options?: {
  results?: ComponentContext[];   // stub results to return (default: [])
  mode?: 'discovery' | 'production';  // stub mode (default: 'discovery')
})
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `calls` | `ContextQueryRequest[]` | All recorded requests, in order |

### Methods

| Method | Description |
|--------|-------------|
| `query(request)` | Returns `{ mode, results: stubResults.slice(0, topK) }`. Records the request. |
| `assertCallCount(n)` | Throws if `calls.length !== n` |
| `assertLastQuery(query)` | Throws if the last recorded request's `query` field doesn't equal `query` |

### Usage example (vitest)

```typescript
import { describe, it } from 'vitest';
import { RecordingContextQueryPort } from '@method/fca-index/testkit';
import type { ComponentContext } from '@method/fca-index';

describe('my handler', () => {
  it('queries the index and formats results', async () => {
    const stubResults: ComponentContext[] = [
      {
        path: 'src/domains/sessions/',
        level: 'L2',
        parts: [
          { part: 'port', filePath: 'src/domains/sessions/ports.ts', excerpt: 'export interface SessionPort' },
        ],
        relevanceScore: 0.91,
        coverageScore: 0.87,
      },
    ];

    const port = new RecordingContextQueryPort({ results: stubResults, mode: 'production' });

    // Pass to the handler under test
    await myContextHandler({ contextQuery: port, query: 'session lifecycle' });

    port.assertCallCount(1);
    port.assertLastQuery('session lifecycle');
  });
});
```

---

## RecordingCoverageReportPort

A test double for `CoverageReportPort`. Returns a configurable stub report and records every call.

### Constructor

```typescript
new RecordingCoverageReportPort(stub?: Partial<CoverageReport>)
```

The stub is merged over a default `CoverageReport` with all-zero scores and `mode: 'discovery'`. Supply only the fields your test cares about.

Default stub values:

```typescript
{
  mode: 'discovery',
  summary: {
    totalComponents: 0,
    overallScore: 0,
    threshold: 0.8,
    meetsThreshold: false,
    fullyDocumented: 0,
    partiallyDocumented: 0,
    undocumented: 0,
    byPart: { interface: 0, boundary: 0, port: 0, domain: 0, architecture: 0, verification: 0, observability: 0, documentation: 0 },
  },
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `calls` | `CoverageReportRequest[]` | All recorded requests, in order |

### Methods

| Method | Description |
|--------|-------------|
| `getReport(request)` | Returns the stub report merged with `projectRoot` and `generatedAt`. Records the request. |
| `assertCallCount(n)` | Throws if `calls.length !== n` |

### Usage example (vitest)

```typescript
import { RecordingCoverageReportPort } from '@method/fca-index/testkit';

const port = new RecordingCoverageReportPort({
  mode: 'production',
  summary: {
    totalComponents: 12,
    overallScore: 0.92,
    threshold: 0.8,
    meetsThreshold: true,
    fullyDocumented: 10,
    partiallyDocumented: 2,
    undocumented: 0,
    byPart: {
      interface: 1.0, documentation: 0.92, port: 0.75, boundary: 0.5,
      domain: 1.0, architecture: 0.83, verification: 0.67, observability: 0.58,
    },
  },
});

await myCoverageHandler({ coverageReport: port, projectRoot: '/tmp/project' });

port.assertCallCount(1);
```
