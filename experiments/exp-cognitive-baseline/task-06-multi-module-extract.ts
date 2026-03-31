/**
 * Task 06: Multi-Module Extract — Workspace Retention Stress Test
 *
 * A monolithic event system has an EventBus class tightly coupled with
 * EventStore and EventRouter in a single file, plus config, types, utils,
 * middleware, and test files that all reference EventBus.
 *
 * The task: extract EventBus into its own module (src/event-bus.ts), create
 * an IEventBus interface, and update ALL 7 import sites — while preserving
 * all 8 public methods of EventBus and not breaking the other two classes.
 *
 * Designed to require 25-35 cycles:
 * - ~8 cycles reading and understanding 9 initial files
 * - ~5 cycles planning the extraction and interface design
 * - ~3 cycles creating the new files (event-bus.ts, interfaces.ts)
 * - ~10 cycles updating all 7 import sites one by one
 * - ~5 cycles verifying nothing is broken, fixing oversights
 *
 * The "trap" is goal drift: after 15-20 cycles the agent may forget one of:
 * - An import site buried in middleware.ts or the test file
 * - One of the 8 public methods that must be preserved on EventBus
 * - The requirement to create an IEventBus interface (not just move the class)
 * - Updating the barrel export in index.ts
 * - Keeping EventStore and EventRouter working (they depend on EventBus)
 */

export const TASK_06 = {
  name: 'multi-module-extract',
  // For flat/CLI conditions — no cognitive-specific signals
  baseDescription: `You are working on a TypeScript project with a monolithic event system.

The file src/event-system.ts contains three tightly coupled classes: EventBus, EventStore, and EventRouter. The EventBus class has 8 public methods and is referenced across 7 other files.

Your task: Extract the EventBus class into its own module while creating a clean interface boundary.

Specifically:
1. Create src/event-bus.ts containing the EventBus class (moved from event-system.ts)
2. Create src/interfaces/event-bus.interface.ts with an IEventBus interface that declares all 8 public methods of EventBus
3. Make EventBus implement IEventBus
4. Update ALL import sites across the codebase to import EventBus from its new location
5. Update src/event-system.ts to import and re-export EventBus from the new module (so EventStore and EventRouter still work)
6. Ensure the barrel export in src/index.ts exports both EventBus and IEventBus
7. Preserve ALL 8 public methods of EventBus: on, off, emit, once, getListenerCount, getEventNames, removeAllListeners, waitFor
8. Do NOT break EventStore or EventRouter — they must still compile and reference EventBus

Start by reading all files to understand the dependency graph, then perform the extraction.`,
  // For cognitive condition — includes "done" completion signal
  description: `You are working on a TypeScript project with a monolithic event system.

The file src/event-system.ts contains three tightly coupled classes: EventBus, EventStore, and EventRouter. The EventBus class has 8 public methods and is referenced across 7 other files.

Your task: Extract the EventBus class into its own module while creating a clean interface boundary.

Specifically:
1. Create src/event-bus.ts containing the EventBus class (moved from event-system.ts)
2. Create src/interfaces/event-bus.interface.ts with an IEventBus interface that declares all 8 public methods of EventBus
3. Make EventBus implement IEventBus
4. Update ALL import sites across the codebase to import EventBus from its new location
5. Update src/event-system.ts to import and re-export EventBus from the new module (so EventStore and EventRouter still work)
6. Ensure the barrel export in src/index.ts exports both EventBus and IEventBus
7. Preserve ALL 8 public methods of EventBus: on, off, emit, once, getListenerCount, getEventNames, removeAllListeners, waitFor
8. Do NOT break EventStore or EventRouter — they must still compile and reference EventBus

Start by reading all files to understand the dependency graph, then perform the extraction.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    // -----------------------------------------------------------------------
    // The monolith: 3 classes, ~200 lines, tightly coupled
    // -----------------------------------------------------------------------
    'src/event-system.ts': `import { EventConfig, DEFAULT_CONFIG } from './config';
import { EventPayload, EventHandler, EventFilter } from './types';
import { generateEventId, validateEventName } from './utils';

/**
 * Core event bus — pub/sub backbone of the system.
 * 8 public methods: on, off, emit, once, getListenerCount, getEventNames, removeAllListeners, waitFor
 */
export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private config: EventConfig;

  constructor(config: Partial<EventConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Subscribe to an event */
  on(eventName: string, handler: EventHandler): void {
    validateEventName(eventName);
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    const handlers = this.handlers.get(eventName)!;
    if (handlers.size >= this.config.maxListenersPerEvent) {
      throw new Error(\`Max listeners (\${this.config.maxListenersPerEvent}) reached for event: \${eventName}\`);
    }
    handlers.add(handler);
  }

  /** Unsubscribe from an event */
  off(eventName: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventName);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlers.delete(eventName);
    }
  }

  /** Emit an event to all subscribers */
  emit(eventName: string, payload: EventPayload): void {
    validateEventName(eventName);
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;
    const eventId = generateEventId();
    const enrichedPayload: EventPayload = {
      ...payload,
      _meta: { eventId, timestamp: Date.now(), eventName },
    };
    for (const handler of handlers) {
      try {
        handler(enrichedPayload);
      } catch (err) {
        if (this.config.throwOnHandlerError) throw err;
        console.error(\`[EventBus] Handler error for \${eventName}:\`, err);
      }
    }
  }

  /** Subscribe to an event, auto-unsubscribe after first invocation */
  once(eventName: string, handler: EventHandler): void {
    const wrapper: EventHandler = (payload) => {
      this.off(eventName, wrapper);
      handler(payload);
    };
    this.on(eventName, wrapper);
  }

  /** Get the count of listeners for a specific event */
  getListenerCount(eventName: string): number {
    return this.handlers.get(eventName)?.size ?? 0;
  }

  /** Get all event names that have active listeners */
  getEventNames(): string[] {
    return [...this.handlers.keys()];
  }

  /** Remove all listeners, optionally for a specific event */
  removeAllListeners(eventName?: string): void {
    if (eventName) {
      this.handlers.delete(eventName);
    } else {
      this.handlers.clear();
    }
  }

  /** Wait for an event to be emitted (promise-based) */
  waitFor(eventName: string, timeoutMs?: number): Promise<EventPayload> {
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs ?? this.config.defaultTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (timeout > 0) {
        timer = setTimeout(() => {
          this.off(eventName, handler);
          reject(new Error(\`Timeout waiting for event: \${eventName}\`));
        }, timeout);
      }

      const handler: EventHandler = (payload) => {
        if (timer) clearTimeout(timer);
        this.off(eventName, handler);
        resolve(payload);
      };
      this.on(eventName, handler);
    });
  }
}

/**
 * Persists events to an in-memory store with replay capability.
 * Depends on EventBus for subscription.
 */
export class EventStore {
  private events: Array<{ eventName: string; payload: EventPayload; storedAt: number }> = [];
  private maxSize: number;

  constructor(private bus: EventBus, maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /** Start recording events matching the filter */
  record(eventNames: string[]): void {
    for (const name of eventNames) {
      this.bus.on(name, (payload) => {
        this.events.push({ eventName: name, payload, storedAt: Date.now() });
        if (this.events.length > this.maxSize) {
          this.events.shift();
        }
      });
    }
  }

  /** Replay stored events through the bus */
  replay(filter?: EventFilter): void {
    const toReplay = filter
      ? this.events.filter((e) => filter(e.eventName, e.payload))
      : this.events;
    for (const event of toReplay) {
      this.bus.emit(event.eventName, event.payload);
    }
  }

  /** Get stored event count */
  getCount(): number {
    return this.events.length;
  }

  /** Clear all stored events */
  clear(): void {
    this.events = [];
  }
}

/**
 * Routes events between buses based on configurable rules.
 * Depends on EventBus for both source and target subscriptions.
 */
export class EventRouter {
  private rules: Array<{ pattern: RegExp; target: EventBus; transform?: (p: EventPayload) => EventPayload }> = [];

  constructor(private source: EventBus) {}

  /** Add a routing rule: events matching the pattern get forwarded to target */
  addRule(pattern: string | RegExp, target: EventBus, transform?: (p: EventPayload) => EventPayload): void {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    this.rules.push({ pattern: regex, target, transform });
  }

  /** Start routing — subscribe to all current event names on source */
  start(): void {
    const names = this.source.getEventNames();
    for (const name of names) {
      this.source.on(name, (payload) => {
        for (const rule of this.rules) {
          if (rule.pattern.test(name)) {
            const transformed = rule.transform ? rule.transform(payload) : payload;
            rule.target.emit(name, transformed);
          }
        }
      });
    }
  }

  /** Get the number of active routing rules */
  getRuleCount(): number {
    return this.rules.length;
  }
}
`,

    // -----------------------------------------------------------------------
    // Types — referenced by event-system.ts and most other files
    // -----------------------------------------------------------------------
    'src/types.ts': `/** Payload carried by every event */
export interface EventPayload {
  [key: string]: unknown;
  _meta?: {
    eventId: string;
    timestamp: number;
    eventName: string;
  };
}

/** Handler function signature */
export type EventHandler = (payload: EventPayload) => void;

/** Filter predicate for event queries */
export type EventFilter = (eventName: string, payload: EventPayload) => boolean;

/** Subscription token returned by some APIs */
export interface Subscription {
  eventName: string;
  unsubscribe: () => void;
}
`,

    // -----------------------------------------------------------------------
    // Config — used by EventBus constructor
    // -----------------------------------------------------------------------
    'src/config.ts': `export interface EventConfig {
  maxListenersPerEvent: number;
  throwOnHandlerError: boolean;
  defaultTimeoutMs: number;
  enableDebugLogging: boolean;
}

export const DEFAULT_CONFIG: EventConfig = {
  maxListenersPerEvent: 100,
  throwOnHandlerError: false,
  defaultTimeoutMs: 30000,
  enableDebugLogging: false,
};
`,

    // -----------------------------------------------------------------------
    // Utils — pure helpers used by EventBus
    // -----------------------------------------------------------------------
    'src/utils.ts': `let counter = 0;

/** Generate a unique event ID */
export function generateEventId(): string {
  return \`evt_\${Date.now()}_\${++counter}\`;
}

/** Validate that an event name is well-formed */
export function validateEventName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Event name must be a non-empty string');
  }
  if (name.length > 256) {
    throw new Error('Event name must be 256 characters or fewer');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9.:_-]*$/.test(name)) {
    throw new Error(\`Invalid event name: \${name} — must match /^[a-zA-Z][a-zA-Z0-9.:_-]*$/\`);
  }
}
`,

    // -----------------------------------------------------------------------
    // Middleware — wraps EventBus with logging/filtering (import site #1)
    // -----------------------------------------------------------------------
    'src/middleware.ts': `import { EventBus } from './event-system';
import { EventPayload, EventHandler } from './types';

/**
 * Logging middleware — wraps an EventBus to log all emitted events.
 */
export class LoggingMiddleware {
  private logs: Array<{ eventName: string; payload: EventPayload; timestamp: number }> = [];

  constructor(private bus: EventBus) {}

  /** Wrap the bus emit to capture logs */
  install(): void {
    const originalEmit = this.bus.emit.bind(this.bus);
    this.bus.emit = (eventName: string, payload: EventPayload) => {
      this.logs.push({ eventName, payload, timestamp: Date.now() });
      originalEmit(eventName, payload);
    };
  }

  /** Get all logged events */
  getLogs(): ReadonlyArray<{ eventName: string; payload: EventPayload; timestamp: number }> {
    return this.logs;
  }

  /** Clear log history */
  clearLogs(): void {
    this.logs = [];
  }
}

/**
 * Filtering middleware — wraps an EventBus to block events matching a deny list.
 */
export class FilteringMiddleware {
  private denyList: Set<string> = new Set();

  constructor(private bus: EventBus) {}

  /** Add event names to the deny list */
  deny(eventNames: string[]): void {
    for (const name of eventNames) {
      this.denyList.add(name);
    }
  }

  /** Wrap the bus emit to filter denied events */
  install(): void {
    const originalEmit = this.bus.emit.bind(this.bus);
    this.bus.emit = (eventName: string, payload: EventPayload) => {
      if (this.denyList.has(eventName)) return;
      originalEmit(eventName, payload);
    };
  }
}
`,

    // -----------------------------------------------------------------------
    // Plugin system — discovers and wires plugins to EventBus (import site #2)
    // -----------------------------------------------------------------------
    'src/plugins/plugin-manager.ts': `import { EventBus } from '../event-system';
import { EventPayload } from '../types';

export interface Plugin {
  name: string;
  version: string;
  init(bus: EventBus): void;
  destroy?(): void;
}

/**
 * Manages lifecycle of plugins that hook into the EventBus.
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();

  constructor(private bus: EventBus) {}

  /** Register and initialize a plugin */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(\`Plugin already registered: \${plugin.name}\`);
    }
    plugin.init(this.bus);
    this.plugins.set(plugin.name, plugin);
    this.bus.emit('plugin.registered', { pluginName: plugin.name, version: plugin.version } as EventPayload);
  }

  /** Unregister and destroy a plugin */
  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    plugin.destroy?.();
    this.plugins.delete(name);
    this.bus.emit('plugin.unregistered', { pluginName: name } as EventPayload);
  }

  /** Get names of all registered plugins */
  getRegisteredPlugins(): string[] {
    return [...this.plugins.keys()];
  }

  /** Get plugin count */
  getPluginCount(): number {
    return this.plugins.size;
  }
}
`,

    // -----------------------------------------------------------------------
    // Health check — monitors EventBus health (import site #3)
    // -----------------------------------------------------------------------
    'src/health.ts': `import { EventBus } from './event-system';

export interface HealthStatus {
  healthy: boolean;
  listenerCount: number;
  eventNames: string[];
  uptime: number;
}

/**
 * Monitors EventBus health for operational dashboards.
 */
export class HealthCheck {
  private startTime: number;

  constructor(private bus: EventBus) {
    this.startTime = Date.now();
  }

  /** Get current health status */
  getStatus(): HealthStatus {
    const eventNames = this.bus.getEventNames();
    let totalListeners = 0;
    for (const name of eventNames) {
      totalListeners += this.bus.getListenerCount(name);
    }
    return {
      healthy: true,
      listenerCount: totalListeners,
      eventNames,
      uptime: Date.now() - this.startTime,
    };
  }

  /** Emit a health check event through the bus */
  ping(): void {
    this.bus.emit('system.health.ping', { timestamp: Date.now() });
  }
}
`,

    // -----------------------------------------------------------------------
    // Factory — convenience constructors (import site #4)
    // -----------------------------------------------------------------------
    'src/factory.ts': `import { EventBus, EventStore, EventRouter } from './event-system';
import { EventConfig } from './config';

export interface SystemComponents {
  bus: EventBus;
  store: EventStore;
  router: EventRouter;
}

/**
 * Factory for creating pre-configured event system instances.
 */
export function createEventSystem(config?: Partial<EventConfig>): SystemComponents {
  const bus = new EventBus(config);
  const store = new EventStore(bus);
  const router = new EventRouter(bus);
  return { bus, store, router };
}

/**
 * Create a minimal EventBus for testing.
 */
export function createTestBus(): EventBus {
  return new EventBus({ maxListenersPerEvent: 10, throwOnHandlerError: true, defaultTimeoutMs: 1000, enableDebugLogging: true });
}

/**
 * Create a pair of buses with a router connecting them.
 */
export function createLinkedBuses(config?: Partial<EventConfig>): { primary: EventBus; secondary: EventBus; router: EventRouter } {
  const primary = new EventBus(config);
  const secondary = new EventBus(config);
  const router = new EventRouter(primary);
  router.addRule('.*', secondary);
  return { primary, secondary, router };
}
`,

    // -----------------------------------------------------------------------
    // Tests — integration tests for EventBus (import site #5)
    // -----------------------------------------------------------------------
    'tests/event-bus.test.ts': `import { EventBus, EventStore } from '../src/event-system';
import { EventPayload } from '../src/types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ throwOnHandlerError: true, maxListenersPerEvent: 50, defaultTimeoutMs: 5000, enableDebugLogging: false });
  });

  it('should register and invoke handlers', () => {
    const received: EventPayload[] = [];
    bus.on('test.event', (p) => received.push(p));
    bus.emit('test.event', { value: 42 });
    expect(received.length).toBe(1);
    expect(received[0].value).toBe(42);
  });

  it('should unsubscribe handlers with off()', () => {
    const handler = (_p: EventPayload) => {};
    bus.on('test.event', handler);
    expect(bus.getListenerCount('test.event')).toBe(1);
    bus.off('test.event', handler);
    expect(bus.getListenerCount('test.event')).toBe(0);
  });

  it('should support once() for single-fire listeners', () => {
    let callCount = 0;
    bus.once('test.once', () => callCount++);
    bus.emit('test.once', {});
    bus.emit('test.once', {});
    expect(callCount).toBe(1);
  });

  it('should report event names and listener counts', () => {
    bus.on('a', () => {});
    bus.on('b', () => {});
    bus.on('b', () => {});
    expect(bus.getEventNames().sort()).toEqual(['a', 'b']);
    expect(bus.getListenerCount('a')).toBe(1);
    expect(bus.getListenerCount('b')).toBe(2);
  });

  it('should remove all listeners', () => {
    bus.on('a', () => {});
    bus.on('b', () => {});
    bus.removeAllListeners();
    expect(bus.getEventNames()).toEqual([]);
  });

  it('should support waitFor with timeout', async () => {
    setTimeout(() => bus.emit('delayed', { v: 1 }), 50);
    const result = await bus.waitFor('delayed', 2000);
    expect(result.v).toBe(1);
  });
});

describe('EventStore', () => {
  it('should record and replay events', () => {
    const bus = new EventBus();
    const store = new EventStore(bus);
    store.record(['order.created']);
    bus.emit('order.created', { orderId: '123' });
    bus.emit('order.created', { orderId: '456' });
    expect(store.getCount()).toBe(2);
  });
});
`,

    // -----------------------------------------------------------------------
    // Barrel export (import site #6 — re-exports everything)
    // -----------------------------------------------------------------------
    'src/index.ts': `// Core event system
export { EventBus, EventStore, EventRouter } from './event-system';

// Types
export { EventPayload, EventHandler, EventFilter, Subscription } from './types';

// Config
export { EventConfig, DEFAULT_CONFIG } from './config';

// Utils
export { generateEventId, validateEventName } from './utils';

// Middleware
export { LoggingMiddleware, FilteringMiddleware } from './middleware';

// Plugins
export { PluginManager, Plugin } from './plugins/plugin-manager';

// Health
export { HealthCheck, HealthStatus } from './health';

// Factory
export { createEventSystem, createTestBus, createLinkedBuses, SystemComponents } from './factory';
`,
  },

  /**
   * Comprehensive validation: 10 checks covering every aspect of the extraction.
   * An agent that drifts mid-task will fail on at least one of these.
   */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    // ── Check 1: src/event-bus.ts exists and contains the EventBus class ──
    const eventBusFile = files.get('src/event-bus.ts');
    if (!eventBusFile) {
      return { success: false, reason: 'src/event-bus.ts does not exist — EventBus was not extracted to its own module' };
    }
    if (!eventBusFile.includes('class EventBus')) {
      return { success: false, reason: 'src/event-bus.ts does not contain the EventBus class' };
    }

    // ── Check 2: All 8 public methods are preserved on EventBus ──
    const requiredMethods = ['on(', 'off(', 'emit(', 'once(', 'getListenerCount(', 'getEventNames(', 'removeAllListeners(', 'waitFor('];
    for (const method of requiredMethods) {
      if (!eventBusFile.includes(method)) {
        return { success: false, reason: `EventBus in src/event-bus.ts is missing public method: ${method.replace('(', '()')}` };
      }
    }

    // ── Check 3: IEventBus interface exists ──
    const interfaceFile = files.get('src/interfaces/event-bus.interface.ts');
    if (!interfaceFile) {
      return { success: false, reason: 'src/interfaces/event-bus.interface.ts does not exist — IEventBus interface was not created' };
    }
    if (!interfaceFile.includes('interface IEventBus') && !interfaceFile.includes('export interface IEventBus')) {
      return { success: false, reason: 'src/interfaces/event-bus.interface.ts does not declare IEventBus interface' };
    }
    // Interface must declare all 8 methods
    for (const method of requiredMethods) {
      if (!interfaceFile.includes(method.replace('(', ''))) {
        return { success: false, reason: `IEventBus interface is missing method declaration: ${method.replace('(', '()')}` };
      }
    }

    // ── Check 4: EventBus implements IEventBus ──
    if (!eventBusFile.includes('implements IEventBus') && !eventBusFile.includes('implements  IEventBus')) {
      return { success: false, reason: 'EventBus class does not implement IEventBus' };
    }

    // ── Check 5: event-system.ts re-exports EventBus from the new module ──
    const eventSystemFile = files.get('src/event-system.ts');
    if (!eventSystemFile) {
      return { success: false, reason: 'src/event-system.ts was deleted — it should still exist with EventStore and EventRouter' };
    }
    // It should import EventBus from the new location
    if (!eventSystemFile.includes("from './event-bus'") && !eventSystemFile.includes('from "./event-bus"') &&
        !eventSystemFile.includes("from '../event-bus'") && !eventSystemFile.includes('from "../event-bus"')) {
      // Also accept re-export syntax
      const reExportsEventBus = eventSystemFile.includes("export { EventBus }") ||
        eventSystemFile.includes("export {EventBus}") ||
        eventSystemFile.includes("export { EventBus,") ||
        eventSystemFile.includes("export { EventBus }") ||
        (eventSystemFile.includes("import") && eventSystemFile.includes("EventBus") && eventSystemFile.includes("event-bus"));
      if (!reExportsEventBus) {
        return { success: false, reason: 'src/event-system.ts does not import EventBus from src/event-bus.ts — EventStore and EventRouter will break' };
      }
    }
    // EventStore and EventRouter must still be in event-system.ts
    if (!eventSystemFile.includes('class EventStore')) {
      return { success: false, reason: 'EventStore class was removed from src/event-system.ts' };
    }
    if (!eventSystemFile.includes('class EventRouter')) {
      return { success: false, reason: 'EventRouter class was removed from src/event-system.ts' };
    }
    // EventBus class definition should NOT remain in event-system.ts (it was moved)
    if (eventSystemFile.includes('class EventBus {') || eventSystemFile.includes('class EventBus  {')) {
      return { success: false, reason: 'EventBus class definition is still in src/event-system.ts — it should be moved to src/event-bus.ts' };
    }

    // ── Check 6: middleware.ts updated to import from new location ──
    const middlewareFile = files.get('src/middleware.ts');
    if (!middlewareFile) {
      return { success: false, reason: 'src/middleware.ts was deleted' };
    }
    if (!middlewareFile.includes('EventBus')) {
      return { success: false, reason: 'src/middleware.ts no longer references EventBus' };
    }
    // Should import from event-bus (direct) or event-system (re-export) — either is acceptable
    const middlewareImportsUpdated =
      middlewareFile.includes("from './event-bus'") ||
      middlewareFile.includes('from "./event-bus"') ||
      middlewareFile.includes("from './event-system'") ||
      middlewareFile.includes('from "./event-system"');
    if (!middlewareImportsUpdated) {
      return { success: false, reason: 'src/middleware.ts has broken imports for EventBus' };
    }

    // ── Check 7: plugin-manager.ts updated to import from new location ──
    const pluginFile = files.get('src/plugins/plugin-manager.ts');
    if (!pluginFile) {
      return { success: false, reason: 'src/plugins/plugin-manager.ts was deleted' };
    }
    if (!pluginFile.includes('EventBus')) {
      return { success: false, reason: 'src/plugins/plugin-manager.ts no longer references EventBus' };
    }
    const pluginImportsValid =
      pluginFile.includes("from '../event-bus'") ||
      pluginFile.includes('from "../event-bus"') ||
      pluginFile.includes("from '../event-system'") ||
      pluginFile.includes('from "../event-system"');
    if (!pluginImportsValid) {
      return { success: false, reason: 'src/plugins/plugin-manager.ts has broken imports for EventBus' };
    }

    // ── Check 8: health.ts updated ──
    const healthFile = files.get('src/health.ts');
    if (!healthFile) {
      return { success: false, reason: 'src/health.ts was deleted' };
    }
    if (!healthFile.includes('EventBus')) {
      return { success: false, reason: 'src/health.ts no longer references EventBus' };
    }

    // ── Check 9: factory.ts still works ──
    const factoryFile = files.get('src/factory.ts');
    if (!factoryFile) {
      return { success: false, reason: 'src/factory.ts was deleted' };
    }
    if (!factoryFile.includes('EventBus')) {
      return { success: false, reason: 'src/factory.ts no longer references EventBus' };
    }
    if (!factoryFile.includes('createEventSystem') || !factoryFile.includes('createTestBus') || !factoryFile.includes('createLinkedBuses')) {
      return { success: false, reason: 'Factory functions were removed from src/factory.ts' };
    }

    // ── Check 10: index.ts barrel exports both EventBus and IEventBus ──
    const indexFile = files.get('src/index.ts');
    if (!indexFile) {
      return { success: false, reason: 'src/index.ts was deleted' };
    }
    if (!indexFile.includes('EventBus')) {
      return { success: false, reason: 'src/index.ts does not export EventBus' };
    }
    if (!indexFile.includes('IEventBus')) {
      return { success: false, reason: 'src/index.ts does not export IEventBus — the interface must be part of the public API' };
    }

    // ── Check 11: test file still references EventBus and can find it ──
    const testFile = files.get('tests/event-bus.test.ts');
    if (!testFile) {
      return { success: false, reason: 'tests/event-bus.test.ts was deleted' };
    }
    if (!testFile.includes('EventBus')) {
      return { success: false, reason: 'tests/event-bus.test.ts no longer references EventBus' };
    }
    // Test should import from somewhere that resolves (event-bus, event-system, or index)
    const testImportValid =
      testFile.includes("from '../src/event-bus'") ||
      testFile.includes('from "../src/event-bus"') ||
      testFile.includes("from '../src/event-system'") ||
      testFile.includes('from "../src/event-system"') ||
      testFile.includes("from '../src'") ||
      testFile.includes('from "../src"') ||
      testFile.includes("from '../src/index'") ||
      testFile.includes('from "../src/index"');
    if (!testImportValid) {
      return { success: false, reason: 'tests/event-bus.test.ts has broken imports — cannot resolve EventBus' };
    }

    // ── Check 12: No circular dependency between event-bus.ts and event-system.ts ──
    if (eventBusFile.includes("from './event-system'") || eventBusFile.includes('from "./event-system"') ||
        eventBusFile.includes("from '../event-system'") || eventBusFile.includes('from "../event-system"')) {
      return { success: false, reason: 'src/event-bus.ts imports from src/event-system.ts — circular dependency introduced' };
    }

    return {
      success: true,
      reason: 'EventBus extracted to own module, IEventBus interface created, all 8 public methods preserved, all import sites updated, no circular dependencies, EventStore and EventRouter intact',
    };
  },
};
