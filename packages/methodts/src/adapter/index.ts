// SPDX-License-Identifier: Apache-2.0
/**
 * adapter/ — YAML ↔ TypeScript serialization layer.
 *
 * YamlAdapter: bidirectional converter between raw YAML objects and typed
 *   methodology/method/step structures. Used by runtime/, strategy/, and CLI.
 * PredicateParser: parses predicate expressions from YAML string notation
 *   into typed Predicate AST nodes.
 * yaml-types.ts: raw YAML schema shapes (before conversion/validation).
 */

export { loadMethodFromYamlString, loadMethodFromFile, loadMethodologyFromYamlString, loadMethodologyFromFile, convertDomain } from './yaml-adapter.js';
export type { YamlMethod, YamlPhase, YamlRole, YamlDomainTheory, YamlMethodology, YamlArm } from './yaml-types.js';
export { parsePredicate, parseReturns } from './predicate-parser.js';
