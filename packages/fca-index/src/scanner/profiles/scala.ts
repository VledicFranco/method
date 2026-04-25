// SPDX-License-Identifier: Apache-2.0
/**
 * Scala LanguageProfile — detects FCA parts in Scala (sbt-style) projects.
 *
 * Detection rules:
 *   - `README.md` / `*.md` (excluding test markdown) → documentation
 *   - `*Spec.scala`, `*Test.scala`, `*IntegrationSpec.scala`, `*IT.scala`
 *      → verification
 *   - `architecture.scala`, `Architecture.scala` → architecture
 *   - `*Metrics.scala`, `*Observability.scala`, `*Telemetry.scala`
 *      → observability
 *   - `*Port.scala` → port
 *   - `*Domain.scala` (excluding files ending in `Spec.scala`/`Test.scala`)
 *      → domain
 *   - `package.scala` (with `package` declaration) → interface
 *
 * Subdirectory rules: `ports`, `observability`, `arch`, `domain`.
 *
 * L3 markers: `build.sbt`, `*.sbt` (any file ending in `.sbt`), `pom.xml`.
 *
 * Component qualification: directory contains `package.scala` OR ≥ 2 source
 * files (`.scala`).
 *
 * Doc extraction: ScalaDoc `/​** ... *​/` (same delimiters as JSDoc).
 */

import type { LanguageProfile } from './types.js';

const MAX_EXCERPT = 600;

export const scalaProfile: LanguageProfile = {
  name: 'scala',
  sourceExtensions: ['.scala'],
  packageMarkers: ['build.sbt', '*.sbt', 'pom.xml'],
  filePatterns: [
    // Documentation
    { pattern: /^README\.md$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.md$).*\.md$/, part: 'documentation' },
    // Verification — Scala test conventions
    { pattern: /IntegrationSpec\.scala$/, part: 'verification' },
    { pattern: /Spec\.scala$/, part: 'verification' },
    { pattern: /Test\.scala$/, part: 'verification' },
    { pattern: /IT\.scala$/, part: 'verification' },
    // Architecture
    { pattern: /^[Aa]rchitecture\.scala$/, part: 'architecture' },
    // Observability
    { pattern: /Metrics\.scala$/, part: 'observability' },
    { pattern: /Observability\.scala$/, part: 'observability' },
    { pattern: /Telemetry\.scala$/, part: 'observability' },
    // Port — *Port.scala (case-sensitive Scala convention)
    { pattern: /Port\.scala$/, part: 'port' },
    // Domain — *Domain.scala
    { pattern: /Domain\.scala$/, part: 'domain' },
    // Interface — package.scala
    { pattern: /^package\.scala$/, part: 'interface' },
  ],
  subdirPatterns: {
    ports: 'port',
    observability: 'observability',
    arch: 'architecture',
    domain: 'domain',
  },
  componentRule: {
    interfaceFile: 'package.scala',
    minSourceFiles: 2,
  },
  extractInterfaceExcerpt(content) {
    // Pull the public API surface — `def`, `val`, `trait`, `class`, `object`,
    // `case class`, `case object`, `type` declarations at the top level.
    const lines = content.split('\n');
    const sigLines: string[] = [];
    for (const line of lines) {
      if (
        /^\s*(?:final\s+|sealed\s+|abstract\s+|case\s+|implicit\s+|private\s+|protected\s+|override\s+)*(?:trait|class|object|case\s+class|case\s+object|def|val|var|type)\s+/.test(
          line,
        )
      ) {
        sigLines.push(line);
      }
    }
    if (sigLines.length === 0) {
      return content.slice(0, MAX_EXCERPT).trimEnd();
    }
    return sigLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  },
  extractDocBlock(content) {
    // ScalaDoc uses the same /** ... */ syntax as JSDoc.
    const match = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!match) return '';
    return match[0].slice(0, MAX_EXCERPT).trimEnd();
  },
};
