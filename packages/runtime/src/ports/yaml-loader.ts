// SPDX-License-Identifier: Apache-2.0
/**
 * YamlLoader — Port interface for YAML parse/dump.
 *
 * PRD-057 / S2 §5.3: Only the interface lives in runtime. The js-yaml
 * adapter (`JsYamlLoader`) stays in bridge.
 *
 * Note: Runtime itself may still depend on js-yaml as a utility (parser is
 * transport-free) — what stays in bridge is the **adapter** that implements
 * this port surface.
 */

// ── Port interface ──────────────────────────────────────────────

export interface YamlLoader {
  load(content: string): unknown;
  dump(value: unknown): string;
}
