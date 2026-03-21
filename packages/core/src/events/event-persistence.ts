/**
 * PRD-020: Project Isolation Layer — EventPersistence Interface
 *
 * Abstract interface for event storage (append-only, queryable).
 * No transport dependencies — implementations provided by Wave 2.
 */

import type { ProjectEvent, ProjectEventType } from './project-event.js';

export interface EventFilter {
  projectId?: string;
  type?: ProjectEventType;
  since?: Date;
  until?: Date;
}

export interface EventPersistence {
  /**
   * Append an event (atomic)
   */
  append(event: ProjectEvent): Promise<void>;

  /**
   * Query events with optional filtering
   */
  query(filter: EventFilter): Promise<ProjectEvent[]>;

  /**
   * Get the N most recent events
   */
  latest(count: number): Promise<ProjectEvent[]>;
}

/**
 * Helper to create test events
 */
export function createTestEvent(
  projectId: string,
  type: ProjectEventType,
  data: Record<string, any> = {},
): ProjectEvent {
  return {
    id: Math.random().toString(36).slice(2),
    type,
    projectId,
    timestamp: new Date(),
    data,
    metadata: { test: true },
  };
}
