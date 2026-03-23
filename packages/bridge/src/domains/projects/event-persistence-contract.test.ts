/**
 * EventPersistence Contract Test Suite
 *
 * Reusable contract tests for all EventPersistence implementations.
 * Wave 2 implementations (Redis, PostgreSQL, etc.) should import and run this suite.
 *
 * Usage in implementation test:
 *
 *   import { runEventPersistenceContractTests } from '@method/core';
 *   import { MyPersistenceImpl } from './my-impl';
 *
 *   describe('MyPersistenceImpl', () => {
 *     runEventPersistenceContractTests(
 *       async () => new MyPersistenceImpl(),
 *     );
 *   });
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { EventPersistence, EventFilter } from './events/event-persistence.js';
import { createTestEvent } from './events/event-persistence.js';
import { ProjectEventType } from './events/project-event.js';

/**
 * Run the EventPersistence contract test suite against an implementation
 */
export function runEventPersistenceContractTests(
  factory: () => Promise<EventPersistence>,
  suiteName: string = 'EventPersistence'
): void {
  describe(`EventPersistence Contract: ${suiteName}`, () => {
    let persistence: EventPersistence;

    beforeEach(async () => {
      persistence = await factory();
    });

    describe('append', () => {
      it('appends a single event', async () => {
        const event = createTestEvent('proj-1', ProjectEventType.CREATED, { name: 'test' });
        await persistence.append(event);
        const events = await persistence.latest(1);
        assert.equal(events.length, 1);
        assert.equal(events[0].id, event.id);
      });

      it('preserves event immutability', async () => {
        const event = createTestEvent('proj-1', ProjectEventType.CREATED);
        await persistence.append(event);
        const retrieved = await persistence.latest(1);
        assert.deepEqual(retrieved[0], event);
      });
    });

    describe('query', () => {
      beforeEach(async () => {
        await persistence.append(createTestEvent('proj-1', ProjectEventType.CREATED));
        await persistence.append(createTestEvent('proj-1', ProjectEventType.DISCOVERED));
        await persistence.append(createTestEvent('proj-2', ProjectEventType.CREATED));
      });

      it('filters by projectId', async () => {
        const events = await persistence.query({ projectId: 'proj-1' });
        assert.equal(events.length, 2);
        assert.ok(events.every((e) => e.projectId === 'proj-1'));
      });

      it('filters by type', async () => {
        const events = await persistence.query({ type: ProjectEventType.CREATED });
        assert.equal(events.length, 2);
        assert.ok(events.every((e) => e.type === ProjectEventType.CREATED));
      });

      it('filters by date range (since)', async () => {
        const midpoint = new Date(Date.now() - 500);
        const events = await persistence.query({ since: midpoint });
        assert.ok(events.length > 0);
      });

      it('filters by date range (until)', async () => {
        const futureDate = new Date(Date.now() + 10000);
        const events = await persistence.query({ until: futureDate });
        assert.ok(events.length > 0);
      });

      it('combines multiple filters', async () => {
        const events = await persistence.query({
          projectId: 'proj-1',
          type: ProjectEventType.CREATED,
        });
        assert.equal(events.length, 1);
        assert.equal(events[0].projectId, 'proj-1');
        assert.equal(events[0].type, ProjectEventType.CREATED);
      });

      it('returns empty array on no matches', async () => {
        const events = await persistence.query({ projectId: 'nonexistent' });
        assert.equal(events.length, 0);
      });
    });

    describe('latest', () => {
      beforeEach(async () => {
        for (let i = 0; i < 5; i++) {
          await persistence.append(
            createTestEvent('proj-1', ProjectEventType.CREATED, { index: i })
          );
        }
      });

      it('returns N most recent events in reverse chronological order', async () => {
        const events = await persistence.latest(3);
        assert.equal(events.length, 3);
        assert.ok(events[0].timestamp.getTime() >= events[1].timestamp.getTime());
        assert.ok(events[1].timestamp.getTime() >= events[2].timestamp.getTime());
      });

      it('respects count limit', async () => {
        const events = await persistence.latest(2);
        assert.equal(events.length, 2);
      });

      it('returns all events if count exceeds total', async () => {
        const events = await persistence.latest(100);
        assert.equal(events.length, 5);
      });
    });
  });
}
