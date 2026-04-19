// SPDX-License-Identifier: Apache-2.0
/** Projects domain — collected type re-exports. */

// Discovery service types
export type { ProjectMetadata, DiscoveryCheckpoint, DiscoveryResult } from './discovery-service.js';

// Discovery-registry integration types
export type { DiscoveryWithRegistryResult } from './discovery-registry-integration.js';

// Route types
export type { CircularEventLog, CursorState } from './routes.js';

// Event types
export type { ProjectEvent } from './events/project-event.js';
