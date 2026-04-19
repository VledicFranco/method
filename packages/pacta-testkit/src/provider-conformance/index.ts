// SPDX-License-Identifier: Apache-2.0
/**
 * `@methodts/pacta-testkit/provider-conformance` — reusable conformance
 * rows for pacta `AgentProvider` implementations.
 *
 * Each provider package owns its own row and registers it in its own
 * test file (e.g. `conformance.test.ts`). The row is exercised by the
 * generic runner here, which asserts capabilities, oneshot output, and
 * schema-parseability of the provider's result.
 */

export {
  runProviderConformanceRow,
  ProviderConformanceError,
} from './row.js';

export type {
  ProviderConformanceRow,
  ProviderConformanceReport,
} from './row.js';
