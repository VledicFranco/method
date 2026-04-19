// SPDX-License-Identifier: Apache-2.0
/**
 * commands/ — method-ctl command handler functions.
 *
 * statusCommand: fetches bridge health + cluster overview.
 * nodesCommand: lists cluster peers with resource utilization.
 * projectsCommand: lists discovered projects and active sessions.
 *
 * Each handler: (config, format) → Promise<void>.
 * No process.exit — errors propagate to CLI entry point.
 */

export { statusCommand } from './status.js';
export { nodesCommand } from './nodes.js';
export { projectsCommand } from './projects.js';
