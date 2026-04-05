/**
 * Build Orchestrator REST routes — PRD 047 C-3.
 *
 * Fastify route registration for the build domain. Each route delegates
 * to the BuildOrchestrator and ConversationAdapter instances managed by
 * the domain factory. Follows the same registration pattern used by
 * genesis, registry, and other bridge domains.
 *
 * @see PRD 047 — Build Orchestrator
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BuildOrchestrator, BuildProjectContext } from './orchestrator.js';
import type { ConversationAdapter } from './conversation-adapter.js';
import type { FileCheckpointAdapter } from './checkpoint-adapter.js';
import type { BuildConfig } from './config.js';
import type { AutonomyLevel, EvidenceReport } from './types.js';
import type { GateType } from '../../ports/conversation.js';
import type { EventBus, BridgeEventInput } from '../../ports/event-bus.js';
import type { ProjectLookup } from '../../ports/project-lookup.js';
import { aggregateRefinements } from './refinement.js';

// ── Build registry (in-memory, process-scoped) ──────────────────

export interface BuildEntry {
  orchestrator: BuildOrchestrator;
  conversation: ConversationAdapter;
  requirement: string;
  autonomyLevel: AutonomyLevel;
  projectId?: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  startedAt: string;
  completedAt?: string;
  evidenceReport?: EvidenceReport;
}

export interface BuildRouteContext {
  builds: Map<string, BuildEntry>;
  checkpointAdapter: FileCheckpointAdapter;
  createOrchestrator: (sessionId?: string, projectContext?: BuildProjectContext) => {
    orchestrator: BuildOrchestrator;
    conversation: ConversationAdapter;
  };
  eventBus: EventBus;
  config: BuildConfig;
  projectLookup?: ProjectLookup;
}

// ── Builds Map eviction (F-A-5) ──────────────────────────────

const MAX_BUILDS = 100;

function evictStaleBuilds(builds: Map<string, BuildEntry>): void {
  if (builds.size <= MAX_BUILDS) return;
  const evictable = Array.from(builds.entries())
    .filter(([, e]) => e.status !== 'running')
    .sort((a, b) => (a[1].completedAt ?? a[1].startedAt).localeCompare(b[1].completedAt ?? b[1].startedAt));
  let toRemove = builds.size - MAX_BUILDS;
  for (const [id] of evictable) {
    if (toRemove <= 0) break;
    builds.delete(id);
    toRemove--;
  }
}

// ── Event emission helper ──────────────────────────────────────

function emitBuildEvent(
  eventBus: EventBus,
  type: string,
  severity: 'info' | 'warning' | 'error',
  payload: Record<string, unknown>,
  buildId?: string,
): void {
  const input: BridgeEventInput = {
    version: 1,
    domain: 'build',
    type: `build.${type}`,
    severity,
    payload,
    source: 'bridge/domains/build/routes',
    ...(buildId ? { sessionId: buildId } : {}),
  };
  eventBus.emit(input);
}

// ── Route registration ─────────────────────────────────────────

export function registerBuildRoutes(
  app: FastifyInstance,
  ctx: BuildRouteContext,
): void {
  /**
   * GET /api/builds — List active + recent builds.
   */
  app.get('/api/builds', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const builds = Array.from(ctx.builds.entries()).map(([id, entry]) => ({
        id,
        requirement: entry.requirement,
        autonomyLevel: entry.autonomyLevel,
        projectId: entry.projectId,
        status: entry.status,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      }));

      return reply.status(200).send({ builds });
    } catch (err) {
      return reply.status(500).send({
        error: 'Failed to list builds',
        message: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/builds/analytics — Cross-build analytics (refinements, patterns).
   *
   * NOTE: Registered before /:id routes to avoid Fastify treating "analytics" as an :id param.
   */
  app.get('/api/builds/analytics', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const retrosDir = '.method/retros';
      const refinements = await aggregateRefinements(retrosDir, ctx.config);

      return reply.status(200).send({
        totalBuilds: ctx.builds.size,
        refinements,
      });
    } catch (err) {
      return reply.status(500).send({
        error: 'Failed to compute analytics',
        message: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/builds/:id — Build detail (phase, cost, artifacts, status).
   */
  app.get<{ Params: { id: string } }>(
    '/api/builds/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const entry = ctx.builds.get(req.params.id);
        if (!entry) {
          return reply.status(404).send({
            error: 'Build not found',
            message: `No build with id "${req.params.id}"`,
          });
        }

        return reply.status(200).send({
          id: req.params.id,
          requirement: entry.requirement,
          autonomyLevel: entry.autonomyLevel,
          status: entry.status,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          evidenceReport: entry.evidenceReport,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to get build detail',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * GET /api/builds/:id/conversation — Full conversation history.
   */
  app.get<{ Params: { id: string } }>(
    '/api/builds/:id/conversation',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const entry = ctx.builds.get(req.params.id);
        if (!entry) {
          return reply.status(404).send({
            error: 'Build not found',
            message: `No build with id "${req.params.id}"`,
          });
        }

        const history = await entry.conversation.getHistory(req.params.id);
        return reply.status(200).send({ messages: history });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to get conversation',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * GET /api/builds/:id/evidence — Evidence report for completed build.
   */
  app.get<{ Params: { id: string } }>(
    '/api/builds/:id/evidence',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const entry = ctx.builds.get(req.params.id);
        if (!entry) {
          return reply.status(404).send({
            error: 'Build not found',
            message: `No build with id "${req.params.id}"`,
          });
        }

        if (!entry.evidenceReport) {
          return reply.status(404).send({
            error: 'No evidence report',
            message: `Build "${req.params.id}" has not completed yet or has no evidence report`,
          });
        }

        return reply.status(200).send(entry.evidenceReport);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to get evidence report',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/builds/start — Start a new build.
   */
  app.post<{ Body: { requirement: string; autonomyLevel?: AutonomyLevel; projectId?: string } }>(
    '/api/builds/start',
    async (
      req: FastifyRequest<{ Body: { requirement?: string; autonomyLevel?: AutonomyLevel; projectId?: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { requirement, autonomyLevel, projectId } = req.body;

        if (!requirement || typeof requirement !== 'string' || requirement.trim().length === 0) {
          return reply.status(400).send({
            error: 'Invalid request',
            message: 'requirement field is required and must be a non-empty string',
          });
        }

        // Validate autonomyLevel (F-I-3)
        const validAutonomyLevels: AutonomyLevel[] = ['discuss-all', 'auto-routine', 'full-auto'];
        if (autonomyLevel !== undefined && !validAutonomyLevels.includes(autonomyLevel)) {
          return reply.status(400).send({
            error: 'Invalid autonomy level',
            message: `autonomyLevel must be one of: ${validAutonomyLevels.join(', ')}`,
          });
        }

        // Resolve project context if projectId provided
        let projectContext: BuildProjectContext | undefined;
        if (projectId && ctx.projectLookup) {
          const project = await ctx.projectLookup.getProject(projectId);
          if (!project) {
            return reply.status(404).send({
              error: 'Project not found',
              message: `No project with id "${projectId}"`,
            });
          }
          projectContext = {
            id: project.id,
            name: project.name,
            path: project.path,
            description: project.description,
          };
        }

        const level: AutonomyLevel = autonomyLevel ?? ctx.config.defaultAutonomyLevel as AutonomyLevel;

        const { orchestrator, conversation } = ctx.createOrchestrator(undefined, projectContext);
        const buildId = orchestrator.id;

        const entry: BuildEntry = {
          orchestrator,
          conversation,
          requirement: requirement.trim(),
          autonomyLevel: level,
          projectId,
          status: 'running',
          startedAt: new Date().toISOString(),
        };

        ctx.builds.set(buildId, entry);
        evictStaleBuilds(ctx.builds);

        emitBuildEvent(ctx.eventBus, 'started', 'info', {
          buildId,
          requirement: requirement.trim(),
          autonomyLevel: level,
          projectId: projectId ?? null,
        }, buildId);

        // Start the build in the background (non-blocking) (F-A-7)
        void (async () => {
          try {
            const report = await orchestrator.start(requirement.trim(), level);
            entry.status = 'completed';
            entry.completedAt = new Date().toISOString();
            entry.evidenceReport = report;

            emitBuildEvent(ctx.eventBus, 'completed', 'info', {
              buildId,
              verdict: report.verdict,
              criteriaPassed: report.validation.criteriaPassed,
              criteriaFailed: report.validation.criteriaFailed,
            }, buildId);
          } catch (err) {
            entry.status = 'failed';
            entry.completedAt = new Date().toISOString();

            emitBuildEvent(ctx.eventBus, 'failure_detected', 'error', {
              buildId,
              error: (err as Error).message,
            }, buildId);
          }
        })();

        return reply.status(201).send({ buildId });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to start build',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/builds/:id/message — Human sends a message.
   */
  app.post<{ Params: { id: string }; Body: { content: string; replyTo?: string } }>(
    '/api/builds/:id/message',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { content?: string; replyTo?: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const entry = ctx.builds.get(req.params.id);
        if (!entry) {
          return reply.status(404).send({
            error: 'Build not found',
            message: `No build with id "${req.params.id}"`,
          });
        }

        const { content, replyTo } = req.body;
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
          return reply.status(400).send({
            error: 'Invalid request',
            message: 'content field is required and must be a non-empty string',
          });
        }

        await entry.conversation.receiveHumanMessage(req.params.id, {
          content: content.trim(),
          replyTo,
        });

        emitBuildEvent(ctx.eventBus, 'agent_message', 'info', {
          buildId: req.params.id,
          sender: 'human',
          contentLength: content.trim().length,
        }, req.params.id);

        return reply.status(200).send({ ok: true });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to send message',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/builds/:id/gate/:gate/decide — Human makes a gate decision.
   */
  app.post<{
    Params: { id: string; gate: string };
    Body: { decision: string; feedback?: string; adjustments?: Record<string, unknown> };
  }>(
    '/api/builds/:id/gate/:gate/decide',
    async (
      req: FastifyRequest<{
        Params: { id: string; gate: string };
        Body: { decision?: string; feedback?: string; adjustments?: Record<string, unknown> };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const entry = ctx.builds.get(req.params.id);
        if (!entry) {
          return reply.status(404).send({
            error: 'Build not found',
            message: `No build with id "${req.params.id}"`,
          });
        }

        const gate = req.params.gate as GateType;
        const validGates: GateType[] = ['specify', 'design', 'plan', 'review', 'escalation'];
        if (!validGates.includes(gate)) {
          return reply.status(400).send({
            error: 'Invalid gate',
            message: `Gate must be one of: ${validGates.join(', ')}`,
          });
        }

        const { decision, feedback, adjustments } = req.body;
        const validDecisions = ['approve', 'reject', 'adjust'];
        if (!decision || !validDecisions.includes(decision)) {
          return reply.status(400).send({
            error: 'Invalid decision',
            message: `decision must be one of: ${validDecisions.join(', ')}`,
          });
        }

        entry.conversation.receiveGateDecision(req.params.id, {
          gate,
          decision: decision as 'approve' | 'reject' | 'adjust',
          feedback,
          adjustments,
        });

        emitBuildEvent(ctx.eventBus, 'gate_resolved', 'info', {
          buildId: req.params.id,
          gate,
          decision,
        }, req.params.id);

        return reply.status(200).send({ ok: true });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to process gate decision',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/builds/:id/abort — Abort a running build.
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/builds/:id/abort',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const entry = ctx.builds.get(req.params.id);
        if (!entry) {
          return reply.status(404).send({
            error: 'Build not found',
            message: `No build with id "${req.params.id}"`,
          });
        }

        if (entry.status !== 'running') {
          return reply.status(400).send({
            error: 'Build not running',
            message: `Build "${req.params.id}" is ${entry.status}, cannot abort`,
          });
        }

        entry.status = 'aborted';
        entry.completedAt = new Date().toISOString();

        emitBuildEvent(ctx.eventBus, 'aborted', 'warning', {
          buildId: req.params.id,
          reason: req.body.reason ?? 'User requested abort',
        }, req.params.id);

        return reply.status(200).send({ ok: true });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to abort build',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/builds/:id/resume — Resume from checkpoint.
   */
  app.post<{ Params: { id: string } }>(
    '/api/builds/:id/resume',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const checkpoint = await ctx.checkpointAdapter.load(req.params.id);
        if (!checkpoint) {
          return reply.status(404).send({
            error: 'No checkpoint found',
            message: `No checkpoint for build "${req.params.id}"`,
          });
        }

        // If the build is already running, reject
        const existing = ctx.builds.get(req.params.id);
        if (existing && existing.status === 'running') {
          return reply.status(400).send({
            error: 'Build already running',
            message: `Build "${req.params.id}" is already running`,
          });
        }

        // Create a new orchestrator for the resumed build
        const { orchestrator, conversation } = ctx.createOrchestrator(req.params.id);

        const entry: BuildEntry = {
          orchestrator,
          conversation,
          requirement: checkpoint.featureSpec?.requirement ?? '(resumed)',
          autonomyLevel: ctx.config.defaultAutonomyLevel as AutonomyLevel,
          status: 'running',
          startedAt: new Date().toISOString(),
        };

        ctx.builds.set(req.params.id, entry);

        emitBuildEvent(ctx.eventBus, 'started', 'info', {
          buildId: req.params.id,
          resumed: true,
          fromPhase: checkpoint.phase,
        }, req.params.id);

        return reply.status(200).send({
          ok: true,
          buildId: req.params.id,
          resumedFromPhase: checkpoint.phase,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to resume build',
          message: (err as Error).message,
        });
      }
    },
  );
}
