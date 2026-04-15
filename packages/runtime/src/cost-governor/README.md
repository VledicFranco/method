# Cost Governor Domain — PRD 051

Token cost tracking, per-account rate limiting, and LLM spend governance. Provides the bridge with tools to observe, estimate, and throttle LLM usage across all active sessions.

## Components

| Component | Description |
|-----------|-------------|
| `ObservationsStore` | Append-only store for raw token observations (input/output counts per call) |
| `HistogramCostOracle` | Builds cost histograms from observations; answers P50/P95 queries |
| `SingleAccountRateGovernor` | Token-bucket rate limiter scoped to a single Anthropic account |
| `BackpressureQueue` | Queues requests when rate limit is active; drains when capacity returns |
| `TokenBucket` | Core token-bucket primitive (fill rate + burst capacity) |
| `estimateStrategy` / `heuristicEstimate` | Pre-execution cost estimation before a strategy fires |
| `buildSignature` | Produces a call signature key for cost histogram bucketing |

## Ports

- `FileSystemProvider` — observations persist to disk as JSONL via the port
- `EventBus` — emits `cost.*` events: `observation_recorded`, `rate_limited`, `integrity_violation`

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cost-governor/observations` | Raw observation log |
| `GET` | `/cost-governor/oracle/estimate` | Cost estimate for a given signature |
| `GET` | `/cost-governor/rate-governor/status` | Current bucket level and backpressure state |
| `POST` | `/cost-governor/rate-governor/reset` | Admin reset (testing) |

## Design

Rate limiting uses a token-bucket model. The bucket fills at a configurable rate (tokens/minute) and drains as calls are made. When empty, calls are queued via `BackpressureQueue` rather than rejected — preserving eventual delivery while applying backpressure.

Cost estimation uses historical P95 histograms per call signature. Signatures bucket by model, operation type, and input size — so estimates improve as more observations accumulate.
