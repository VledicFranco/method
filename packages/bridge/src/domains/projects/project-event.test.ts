// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for ProjectEvent
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectEventType,
  createProjectEvent,
  serializeProjectEvent,
  deserializeProjectEvent,
  type ProjectEvent,
} from './events/project-event.js';

describe('ProjectEvent', () => {
  describe('createProjectEvent', () => {
    it('creates an event with all required fields', () => {
      const event = createProjectEvent(ProjectEventType.CREATED, 'proj-1', { name: 'test' });

      assert.ok(event.id);
      assert.ok(event.id.length > 0);
      assert.equal(event.type, ProjectEventType.CREATED);
      assert.equal(event.projectId, 'proj-1');
      assert.ok(event.timestamp instanceof Date);
      assert.deepEqual(event.data, { name: 'test' });
    });

    it('creates an event with default empty data and metadata', () => {
      const event = createProjectEvent(ProjectEventType.CREATED, 'proj-1');

      assert.deepEqual(event.data, {});
      assert.deepEqual(event.metadata, {});
    });

    it('generates unique IDs for multiple events', () => {
      const event1 = createProjectEvent(ProjectEventType.CREATED, 'proj-1');
      const event2 = createProjectEvent(ProjectEventType.CREATED, 'proj-1');

      assert.notEqual(event1.id, event2.id);
    });

    it('timestamps are close together for events created in quick succession', () => {
      const event1 = createProjectEvent(ProjectEventType.CREATED, 'proj-1');
      const event2 = createProjectEvent(ProjectEventType.CREATED, 'proj-1');

      const diffMs = Math.abs(event2.timestamp.getTime() - event1.timestamp.getTime());
      assert.ok(diffMs < 100, 'Should be within 100ms');
    });
  });

  describe('serializeProjectEvent', () => {
    let event: ProjectEvent;

    beforeEach(() => {
      event = createProjectEvent(ProjectEventType.DISCOVERED, 'proj-2', {
        methodologyId: 'P2-SD',
      });
    });

    it('serializes to plain object', () => {
      const serialized = serializeProjectEvent(event);

      assert.deepEqual(serialized, {
        id: event.id,
        type: event.type,
        projectId: event.projectId,
        timestamp: event.timestamp.toISOString(),
        data: event.data,
        metadata: event.metadata,
      });
    });

    it('converts timestamp to ISO string', () => {
      const serialized = serializeProjectEvent(event);

      assert.equal(typeof serialized.timestamp, 'string');
      const diffMs = Math.abs(
        new Date(serialized.timestamp).getTime() - event.timestamp.getTime()
      );
      assert.ok(diffMs < 1000, 'Timestamp should be within 1 second');
    });
  });

  describe('deserializeProjectEvent', () => {
    it('deserializes a valid event from plain object', () => {
      const serialized = {
        id: 'evt-123',
        type: 'CREATED',
        projectId: 'proj-1',
        timestamp: '2026-03-20T10:00:00.000Z',
        data: { name: 'test' },
        metadata: { source: 'test' },
      };

      const event = deserializeProjectEvent(serialized);

      assert.equal(event.id, 'evt-123');
      assert.equal(event.type, 'CREATED');
      assert.equal(event.projectId, 'proj-1');
      assert.ok(event.timestamp instanceof Date);
      assert.deepEqual(event.data, { name: 'test' });
      assert.deepEqual(event.metadata, { source: 'test' });
    });

    it('throws on missing id', () => {
      const invalid = {
        type: 'CREATED',
        projectId: 'proj-1',
        timestamp: new Date().toISOString(),
      };

      assert.throws(() => deserializeProjectEvent(invalid), /missing or invalid id/i);
    });

    it('throws on invalid type', () => {
      const invalid = {
        id: 'evt-123',
        type: 'INVALID_TYPE',
        projectId: 'proj-1',
        timestamp: new Date().toISOString(),
      };

      assert.throws(() => deserializeProjectEvent(invalid), /invalid type/i);
    });

    it('throws on missing projectId', () => {
      const invalid = {
        id: 'evt-123',
        type: 'CREATED',
        timestamp: new Date().toISOString(),
      };

      assert.throws(() => deserializeProjectEvent(invalid), /missing or invalid projectId/i);
    });

    it('throws on invalid timestamp', () => {
      const invalid = {
        id: 'evt-123',
        type: 'CREATED',
        projectId: 'proj-1',
        timestamp: 'not-a-date',
      };

      assert.throws(() => deserializeProjectEvent(invalid), /invalid timestamp/i);
    });

    it('handles Date timestamp directly', () => {
      const now = new Date();
      const serialized = {
        id: 'evt-123',
        type: 'CREATED',
        projectId: 'proj-1',
        timestamp: now,
        data: {},
        metadata: {},
      };

      const event = deserializeProjectEvent(serialized);
      assert.equal(event.timestamp.getTime(), now.getTime());
    });

    it('supports all ProjectEventType values', () => {
      for (const typeValue of Object.values(ProjectEventType)) {
        const serialized = {
          id: 'evt-123',
          type: typeValue,
          projectId: 'proj-1',
          timestamp: new Date().toISOString(),
          data: {},
          metadata: {},
        };

        const event = deserializeProjectEvent(serialized);
        assert.equal(event.type, typeValue);
      }
    });
  });

  describe('round-trip serialization', () => {
    it('deserialize(serialize(event)) === event', () => {
      const original = createProjectEvent(ProjectEventType.PUBLISHED, 'proj-x', {
        release: '1.0.0',
      });

      const serialized = serializeProjectEvent(original);
      const deserialized = deserializeProjectEvent(serialized);

      assert.equal(deserialized.id, original.id);
      assert.equal(deserialized.type, original.type);
      assert.equal(deserialized.projectId, original.projectId);
      const diffMs = Math.abs(
        deserialized.timestamp.getTime() - original.timestamp.getTime()
      );
      assert.ok(diffMs < 1000, 'Timestamps should be within 1 second');
      assert.deepEqual(deserialized.data, original.data);
      assert.deepEqual(deserialized.metadata, original.metadata);
    });
  });
});
