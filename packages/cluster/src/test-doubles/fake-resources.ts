import type { ResourceProvider } from '../ports/resource-provider.js';
import type { ResourceSnapshot } from '../types.js';

export class FakeResources implements ResourceProvider {
  public current: ResourceSnapshot;

  constructor(overrides: Partial<ResourceSnapshot> = {}) {
    this.current = {
      nodeId: 'test-node', instanceName: 'test', cpuCount: 4,
      cpuLoadPercent: 25, memoryTotalMb: 8192, memoryAvailableMb: 4096,
      sessionsActive: 1, sessionsMax: 10, projectCount: 3,
      uptimeMs: 60000, version: '0.1.0', ...overrides,
    };
  }

  snapshot(): ResourceSnapshot {
    return { ...this.current };
  }
}
