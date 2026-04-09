/**
 * resources/ — Resource snapshot schema (PRD 039).
 *
 * ResourceSnapshot: canonical shape for machine resource reports
 *   (CPU usage %, memory available MB, active session count).
 *   Validated with Zod at network boundaries — peers send JSON, this
 *   module parses and validates before the cluster trusts the data.
 *
 * parseResourceSnapshot: throws on invalid input.
 * safeParseResourceSnapshot: returns a Zod SafeParseResult for callers that
 *   need to handle parse failures without exceptions.
 */

export { ResourceSnapshotSchema, parseResourceSnapshot, safeParseResourceSnapshot } from './resource-schema.js';
export type { ResourceSnapshot } from './resource-schema.js';
