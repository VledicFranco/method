// SPDX-License-Identifier: Apache-2.0
/**
 * Language profiles — built-in registry + resolution helper.
 *
 * Profiles ship as plain objects implementing `LanguageProfile`. Consumers can:
 *   - reference built-ins by name in `.fca-index.yaml`
 *     (`languages: ['typescript', 'scala']`),
 *   - or pass `LanguageProfile[]` programmatically to `createFcaIndex` /
 *     `createDefaultFcaIndex` to add a custom profile.
 *
 * `BUILT_IN_PROFILES` is keyed by `LanguageProfile.name`. New built-ins must:
 *   1. Live in `src/scanner/profiles/` as a single file,
 *   2. Be added to `BUILT_IN_PROFILES` here,
 *   3. Ship with a fixture in `tests/fixtures/sample-fca-<lang>/`,
 *   4. Have unit-test coverage in `profiles.test.ts`.
 *
 * `resolveLanguageProfiles(names)` is the runtime resolver — it accepts a
 * string array and returns the matching profiles in the order given. Unknown
 * names throw a `LanguageProfileError`. The CLI/manifest-reader uses this to
 * translate YAML config into runtime profiles.
 *
 * `DEFAULT_LANGUAGES` is the implicit value when no `languages` config is
 * provided — `['typescript']`, preserving v0.3.x behavior.
 */

export type { LanguageProfile, FilePatternRule } from './types.js';

import type { LanguageProfile } from './types.js';
import { typescriptProfile } from './typescript.js';
import { scalaProfile } from './scala.js';
import { pythonProfile } from './python.js';
import { goProfile } from './go.js';
import { markdownOnlyProfile } from './markdown-only.js';

export { typescriptProfile } from './typescript.js';
export { scalaProfile } from './scala.js';
export { pythonProfile } from './python.js';
export { goProfile } from './go.js';
export { markdownOnlyProfile } from './markdown-only.js';

/** Registry of built-in language profiles, keyed by `name`. */
export const BUILT_IN_PROFILES: Readonly<Record<string, LanguageProfile>> = Object.freeze({
  typescript: typescriptProfile,
  scala: scalaProfile,
  python: pythonProfile,
  go: goProfile,
  'markdown-only': markdownOnlyProfile,
});

/** Default language profile list — used when no `languages` config is set. */
export const DEFAULT_LANGUAGES: ReadonlyArray<LanguageProfile> = Object.freeze([typescriptProfile]);

export class LanguageProfileError extends Error {
  constructor(message: string, public readonly code: 'UNKNOWN_PROFILE') {
    super(message);
    this.name = 'LanguageProfileError';
  }
}

/**
 * Resolve a list of profile names to the built-in `LanguageProfile` objects.
 * Order is preserved; unknown names throw `LanguageProfileError`.
 *
 * @example
 *   resolveLanguageProfiles(['typescript', 'scala'])
 *   // → [typescriptProfile, scalaProfile]
 */
export function resolveLanguageProfiles(names: ReadonlyArray<string>): LanguageProfile[] {
  const resolved: LanguageProfile[] = [];
  for (const name of names) {
    const profile = BUILT_IN_PROFILES[name];
    if (!profile) {
      const known = Object.keys(BUILT_IN_PROFILES).sort().join(', ');
      throw new LanguageProfileError(
        `Unknown language profile: '${name}'. Known built-in profiles: ${known}.`,
        'UNKNOWN_PROFILE',
      );
    }
    resolved.push(profile);
  }
  return resolved;
}
