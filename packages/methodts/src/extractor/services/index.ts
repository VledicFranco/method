// SPDX-License-Identifier: Apache-2.0
/**
 * extractor/services/ — Concrete extractor service implementations.
 *
 * command: runs shell commands, parses stdout as structured facts.
 * filesystem: reads files, extracts JSON/YAML/text content as facts.
 * git: reads git metadata (branch, commit, diff, log).
 * http: makes HTTP requests, extracts JSON response data.
 */

export * from './command.js';
export * from './filesystem.js';
export * from './git.js';
export * from './http.js';
