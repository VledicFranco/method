/**
 * PRD-020: Project Isolation Layer — ProjectEvent Schema
 *
 * Core event type for project lifecycle tracking.
 * Immutable, YAML-serializable, append-only.
 */

import { randomUUID } from 'crypto';

export enum ProjectEventType {
  CREATED = 'CREATED',
  REGISTRY_UPDATED = 'REGISTRY_UPDATED',
  DISCOVERED = 'DISCOVERED',
  PUBLISHED = 'PUBLISHED',
  ISOLATED = 'ISOLATED',
}

export interface ProjectEvent {
  id: string;
  type: ProjectEventType;
  projectId: string;
  timestamp: Date;
  data: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Create a new ProjectEvent with default values
 */
export function createProjectEvent(
  type: ProjectEventType,
  projectId: string,
  data: Record<string, any> = {},
  metadata: Record<string, any> = {},
): ProjectEvent {
  return {
    id: randomUUID(),
    type,
    projectId,
    timestamp: new Date(),
    data,
    metadata,
  };
}

/**
 * Serialize ProjectEvent to a plain object for YAML
 */
export function serializeProjectEvent(event: ProjectEvent): any {
  return {
    id: event.id,
    type: event.type,
    projectId: event.projectId,
    timestamp: event.timestamp.toISOString(),
    data: event.data,
    metadata: event.metadata,
  };
}

/**
 * Deserialize ProjectEvent from plain object (e.g., from YAML)
 */
export function deserializeProjectEvent(obj: any): ProjectEvent {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid ProjectEvent: not an object');
  }

  if (!obj.id || typeof obj.id !== 'string') {
    throw new Error('Invalid ProjectEvent: missing or invalid id');
  }

  if (!obj.type || !Object.values(ProjectEventType).includes(obj.type)) {
    throw new Error(`Invalid ProjectEvent: invalid type "${obj.type}"`);
  }

  if (!obj.projectId || typeof obj.projectId !== 'string') {
    throw new Error('Invalid ProjectEvent: missing or invalid projectId');
  }

  let timestamp: Date;
  if (typeof obj.timestamp === 'string') {
    timestamp = new Date(obj.timestamp);
    if (isNaN(timestamp.getTime())) {
      throw new Error(`Invalid ProjectEvent: invalid timestamp "${obj.timestamp}"`);
    }
  } else if (obj.timestamp instanceof Date) {
    timestamp = obj.timestamp;
  } else {
    throw new Error('Invalid ProjectEvent: missing or invalid timestamp');
  }

  return {
    id: obj.id,
    type: obj.type as ProjectEventType,
    projectId: obj.projectId,
    timestamp,
    data: obj.data || {},
    metadata: obj.metadata || {},
  };
}
