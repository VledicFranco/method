/**
 * PRD 018: Event Triggers — Trigger Parser (Phase 2a-1)
 *
 * Extends strategy YAML parsing to extract Phase 2 trigger definitions.
 * Lives in @method/bridge per DR-03 (core has zero transport deps).
 * Backward compatible — manual and mcp_tool triggers still work unchanged.
 */

import yaml from 'js-yaml';
import type { TriggerConfig, TriggerType } from './types.js';

// Types that are event-driven (Phase 2)
const EVENT_TRIGGER_TYPES: TriggerType[] = [
  'git_commit',
  'file_watch',
  'schedule',
  'webhook',
  'pty_watcher',
  'channel_event',
];

export interface ParsedStrategyTriggers {
  strategy_id: string;
  strategy_name: string;
  strategy_version: string;
  triggers: TriggerConfig[];
  event_triggers: TriggerConfig[];  // Only event-driven triggers (excludes manual/mcp_tool)
}

/**
 * Parse a strategy YAML string and extract trigger definitions.
 * Returns both the full trigger list and the event-only subset.
 */
export function parseStrategyTriggers(yamlContent: string): ParsedStrategyTriggers {
  const raw = yaml.load(yamlContent) as { strategy?: Record<string, unknown> };

  if (!raw?.strategy) {
    throw new Error('Invalid strategy YAML: missing "strategy" root key');
  }

  const strategy = raw.strategy;

  if (!strategy.id || typeof strategy.id !== 'string') {
    throw new Error('Invalid strategy YAML: missing "strategy.id"');
  }

  const rawTriggers = (strategy.triggers ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(rawTriggers)) {
    throw new Error('Invalid strategy YAML: "triggers" must be an array');
  }

  const triggers: TriggerConfig[] = [];
  const eventTriggers: TriggerConfig[] = [];

  for (const raw of rawTriggers) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) continue;

    const type = raw.type as string;
    const config = parseSingleTrigger(type, raw);

    if (config) {
      triggers.push(config);
      if (EVENT_TRIGGER_TYPES.includes(type as TriggerType)) {
        eventTriggers.push(config);
      }
    }
  }

  return {
    strategy_id: strategy.id as string,
    strategy_name: (strategy.name as string) ?? '',
    strategy_version: (strategy.version as string) ?? '',
    triggers,
    event_triggers: eventTriggers,
  };
}

/**
 * Check if a strategy YAML has any event triggers (Phase 2 types).
 * Quick check without full parsing.
 */
export function hasEventTriggers(yamlContent: string): boolean {
  try {
    const raw = yaml.load(yamlContent) as { strategy?: { triggers?: unknown[] } };
    const triggers = raw?.strategy?.triggers;
    if (!Array.isArray(triggers)) return false;

    return triggers.some((t) => {
      if (!t || typeof t !== 'object' || !('type' in t)) return false;
      return EVENT_TRIGGER_TYPES.includes((t as { type: string }).type as TriggerType);
    });
  } catch {
    return false;
  }
}

function parseSingleTrigger(
  type: string,
  raw: Record<string, unknown>,
): TriggerConfig | null {
  switch (type) {
    case 'manual':
      return { type: 'manual' };

    case 'mcp_tool':
      return {
        type: 'mcp_tool',
        tool: raw.tool as string | undefined,
      };

    case 'file_watch': {
      const paths = raw.paths;
      if (!paths || !Array.isArray(paths)) return null;
      return {
        type: 'file_watch',
        paths: paths as string[],
        events: raw.events as Array<'create' | 'modify' | 'delete'> | undefined,
        debounce_ms: raw.debounce_ms as number | undefined,
        debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
        max_concurrent: raw.max_concurrent as number | undefined,
        max_batch_size: raw.max_batch_size as number | undefined,
      };
    }

    case 'git_commit':
      return {
        type: 'git_commit',
        branch_pattern: raw.branch_pattern as string | undefined,
        path_pattern: raw.path_pattern as string | undefined,
        debounce_ms: raw.debounce_ms as number | undefined,
        debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
        max_concurrent: raw.max_concurrent as number | undefined,
        max_batch_size: raw.max_batch_size as number | undefined,
      };

    // Phase 2a-2+ types — parsed but not yet supported
    case 'schedule':
    case 'webhook':
    case 'pty_watcher':
    case 'channel_event':
      return null;

    default:
      return null;
  }
}
