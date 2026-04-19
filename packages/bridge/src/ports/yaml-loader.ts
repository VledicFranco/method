// SPDX-License-Identifier: Apache-2.0
import { load, dump } from 'js-yaml';

// ── Port interface ──────────────────────────────────────────────

export interface YamlLoader {
  load(content: string): unknown;
  dump(value: unknown): string;
}

// ── Production implementation ───────────────────────────────────

export class JsYamlLoader implements YamlLoader {
  load(content: string): unknown {
    return load(content);
  }

  dump(value: unknown): string {
    return dump(value);
  }
}
