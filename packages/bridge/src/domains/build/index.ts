/**
 * Build Orchestrator domain — PRD 047.
 *
 * Core orchestrator (C-1): 8-phase build lifecycle, checkpoint persistence,
 * and testable assertion validator. Route wiring and domain factory (C-3).
 */

import type { FastifyInstance } from 'fastify';
import type { EventBus, BridgeEventInput } from '../../ports/event-bus.js';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { YamlLoader } from '../../ports/yaml-loader.js';
import type { BuildConfig } from './config.js';
import { BuildConfigSchema } from './config.js';
import { BuildOrchestrator } from './orchestrator.js';
import { FileCheckpointAdapter } from './checkpoint-adapter.js';
import { ConversationAdapter } from './conversation-adapter.js';
import type { ConversationEvent } from './conversation-adapter.js';
import { registerBuildRoutes } from './routes.js';
import type { BuildEntry, BuildRouteContext } from './routes.js';

// Re-export types for domain consumers
export type {
  BuildState,
  BuildStatus,
  AutonomyLevel,
  ExplorationReport,
  ValidationReport,
  EvidenceReport,
  Refinement,
  PhaseResult,
  CriterionResult,
} from './types.js';

export { BuildConfigSchema, type BuildConfig } from './config.js';
export { buildOrchestratorPact } from './pact.js';

// C-1: Core orchestrator, validator (adapters are internal — use factory)
export { BuildOrchestrator } from './orchestrator.js';
export type { StrategyExecutionResult } from './orchestrator.js';
export { Validator } from './validator.js';
export type { CommandExecutor, CommandExecutorResult } from './validator.js';

// C-3: Routes and domain factory (adapters are internal — use createBuildDomain)
export { registerBuildRoutes } from './routes.js';
export type { BuildEntry, BuildRouteContext } from './routes.js';
export type { ConversationEvent, ConversationEventCallback } from './conversation-adapter.js';

// ── Domain Factory ─────────────────────────────────────────────

export interface CreateBuildDomainOptions {
  eventBus: EventBus;
  fileSystem: FileSystemProvider;
  yamlLoader: YamlLoader;
  buildConfig?: Partial<BuildConfig>;
}

export interface BuildDomain {
  registerRoutes: (app: FastifyInstance) => void;
}

/**
 * Factory function to create the build domain. Wire into the composition
 * root (server-entry.ts) to register routes and initialize adapters.
 *
 * Creates:
 * 1. FileCheckpointAdapter with filesystem and YAML ports
 * 2. ConversationAdapter with event callback wired to the EventBus
 * 3. A registerRoutes function for Fastify route registration
 */
export function createBuildDomain(options: CreateBuildDomainOptions): BuildDomain {
  const config = BuildConfigSchema.parse(options.buildConfig ?? {});

  const checkpointAdapter = new FileCheckpointAdapter(
    config.checkpointDir,
    options.fileSystem,
    options.yamlLoader,
  );

  // Build registry — tracks active and recent builds in memory
  const builds: Map<string, BuildEntry> = new Map();

  // ── ConversationEvent → BridgeEvent mapping ──────────────────

  function onConversationEvent(event: ConversationEvent): void {
    const base: Omit<BridgeEventInput, 'type' | 'payload'> = {
      version: 1,
      domain: 'build',
      severity: 'info',
      source: 'bridge/domains/build/conversation-adapter',
      sessionId: event.buildId,
    };

    switch (event.type) {
      case 'build.agent_message':
        options.eventBus.emit({
          ...base,
          type: 'build.agent_message',
          payload: {
            buildId: event.buildId,
            sender: event.message.sender,
            contentLength: event.message.content.length,
            messageId: event.message.id,
          },
        });
        break;

      case 'build.system_message':
        options.eventBus.emit({
          ...base,
          type: 'build.system_message',
          payload: {
            buildId: event.buildId,
            content: event.message.content,
            messageId: event.message.id,
          },
        });
        break;

      case 'build.skill_request':
        options.eventBus.emit({
          ...base,
          type: 'build.skill_request',
          payload: {
            buildId: event.buildId,
            skillType: event.skill.type,
          },
        });
        break;
    }
  }

  // ── Orchestrator + ConversationAdapter factory ───────────────

  function createOrchestrator(sessionId?: string): {
    orchestrator: BuildOrchestrator;
    conversation: ConversationAdapter;
  } {
    const conversation = new ConversationAdapter({
      sessionDir: config.checkpointDir,
      onEvent: onConversationEvent,
    });

    const orchestrator = new BuildOrchestrator(
      checkpointAdapter,
      conversation,
      config,
      undefined, // Validator — wired separately if needed
      sessionId,
    );

    return { orchestrator, conversation };
  }

  // ── Route context ────────────────────────────────────────────

  const routeContext: BuildRouteContext = {
    builds,
    checkpointAdapter,
    createOrchestrator,
    eventBus: options.eventBus,
    config,
  };

  return {
    registerRoutes(app: FastifyInstance): void {
      registerBuildRoutes(app, routeContext);
    },
  };
}
