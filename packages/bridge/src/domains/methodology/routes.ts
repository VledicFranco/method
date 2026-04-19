// SPDX-License-Identifier: Apache-2.0
/**
 * Methodology HTTP Routes
 *
 * RESTful HTTP endpoints that expose methodology operations via the bridge.
 * Each route maps to one public method on MethodologySessionStore.
 *
 * Endpoint map:
 *   GET  /api/methodology/list                         → store.list()
 *   POST /api/methodology/load                         → store.loadMethod()
 *   GET  /api/methodology/sessions/:sid/status          → store.getStatus()
 *   GET  /api/methodology/sessions/:sid/step/current    → store.getCurrentStep()
 *   POST /api/methodology/sessions/:sid/step/advance    → store.advanceStep()
 *   GET  /api/methodology/sessions/:sid/step/context    → store.getStepContext()
 *   POST /api/methodology/sessions/:sid/step/validate   → store.validateStep()
 *   GET  /api/methodology/:mid/routing                  → store.getRouting()
 *   POST /api/methodology/sessions                      → store.startSession()
 *   POST /api/methodology/sessions/:sid/route           → store.route()
 *   POST /api/methodology/sessions/:sid/select          → store.select()
 *   POST /api/methodology/sessions/:sid/load-method     → store.loadMethodInSession()
 *   POST /api/methodology/sessions/:sid/transition      → store.transition()
 */

import type { FastifyInstance } from "fastify";
import type { MethodologySessionStore } from "./store.js";
import type { SessionPool } from "@methodts/runtime/sessions";
import type { EventBus } from "../../ports/event-bus.js";

export interface MethodologyRoutesDeps {
  pool: SessionPool;
  /** PRD 026: EventBus for methodology domain events */
  eventBus?: EventBus;
}

export function registerMethodologyRoutes(
  app: FastifyInstance,
  store: MethodologySessionStore,
  deps: MethodologyRoutesDeps,
): void {
  const { eventBus } = deps;

  // ── GET /api/methodology/list ──

  app.get("/api/methodology/list", async (_request, reply) => {
    try {
      const result = store.list();
      return reply.status(200).send(result);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  // ── POST /api/methodology/load ──

  app.post<{
    Body: {
      methodology_id: string;
      method_id: string;
      session_id?: string;
    };
  }>("/api/methodology/load", async (request, reply) => {
    try {
      const { methodology_id, method_id, session_id } = request.body ?? {} as any;
      if (!methodology_id || !method_id) {
        return reply.status(400).send({ error: "methodology_id and method_id are required" });
      }
      const sid = session_id ?? "__default__";
      const result = store.loadMethod(sid, methodology_id, method_id);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/methodology/sessions/:sid/status ──

  app.get<{
    Params: { sid: string };
  }>("/api/methodology/sessions/:sid/status", async (request, reply) => {
    try {
      const result = store.getStatus(request.params.sid);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology loaded")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/methodology/sessions/:sid/step/current ──

  app.get<{
    Params: { sid: string };
  }>("/api/methodology/sessions/:sid/step/current", async (request, reply) => {
    try {
      const result = store.getCurrentStep(request.params.sid);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology loaded")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions/:sid/step/advance ──

  app.post<{
    Params: { sid: string };
  }>("/api/methodology/sessions/:sid/step/advance", async (request, reply) => {
    try {
      const sid = request.params.sid;
      const result = store.advanceStep(sid) as {
        methodologyId: string;
        methodId: string;
        previousStep: { id: string; name: string };
        nextStep: { id: string; name: string } | null;
      };

      // PRD 026: Emit step events to Universal Event Bus
      if (eventBus) {
        try {
          if (result.previousStep) {
            eventBus.emit({
              version: 1,
              domain: 'methodology',
              type: 'methodology.step_completed',
              severity: 'info',
              sessionId: sid,
              payload: {
                methodology: result.methodologyId,
                method: result.methodId,
                step: result.previousStep.id,
                step_name: result.previousStep.name,
              },
              source: 'bridge/methodology/routes',
            });
          }
          if (result.nextStep) {
            eventBus.emit({
              version: 1,
              domain: 'methodology',
              type: 'methodology.step_started',
              severity: 'info',
              sessionId: sid,
              payload: {
                methodology: result.methodologyId,
                method: result.methodId,
                step: result.nextStep.id,
                step_name: result.nextStep.name,
              },
              source: 'bridge/methodology/routes',
            });
          }
        } catch { /* non-fatal — bus emission must never block step advance */ }
      }

      // PRD 026 Phase 3: appendMessage removed — events go through EventBus only

      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology loaded")) return reply.status(404).send({ error: msg });
      if (msg.includes("terminal step")) return reply.status(409).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/methodology/sessions/:sid/step/context ──

  app.get<{
    Params: { sid: string };
  }>("/api/methodology/sessions/:sid/step/context", async (request, reply) => {
    try {
      const result = store.getStepContext(request.params.sid);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology loaded")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions/:sid/step/validate ──

  app.post<{
    Params: { sid: string };
    Body: {
      step_id: string;
      output: Record<string, unknown>;
    };
  }>("/api/methodology/sessions/:sid/step/validate", async (request, reply) => {
    try {
      const { step_id, output } = request.body ?? {} as any;
      if (!step_id) {
        return reply.status(400).send({ error: "step_id is required" });
      }
      if (!output || typeof output !== "object") {
        return reply.status(400).send({ error: "output object is required" });
      }
      const result = store.validateStep(request.params.sid, step_id, output);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("mismatch")) return reply.status(400).send({ error: msg });
      if (msg.includes("No methodology loaded")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/methodology/:mid/routing ──

  app.get<{
    Params: { mid: string };
  }>("/api/methodology/:mid/routing", async (request, reply) => {
    try {
      const result = store.getRouting(request.params.mid);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions ──
  // (methodology_start — create a new methodology-level session)

  app.post<{
    Body: {
      methodology_id: string;
      challenge?: string;
      session_id?: string;
    };
  }>("/api/methodology/sessions", async (request, reply) => {
    try {
      const { methodology_id, challenge, session_id } = request.body ?? {} as any;
      if (!methodology_id) {
        return reply.status(400).send({ error: "methodology_id is required" });
      }
      const sid = session_id ?? "__default__";
      const result = store.startSession(sid, methodology_id, challenge ?? null);
      return reply.status(201).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions/:sid/route ──

  app.post<{
    Params: { sid: string };
    Body: {
      challenge_predicates?: Record<string, boolean>;
    };
  }>("/api/methodology/sessions/:sid/route", async (request, reply) => {
    try {
      const { challenge_predicates } = request.body ?? {} as any;
      const result = store.route(request.params.sid, challenge_predicates);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology session active")) return reply.status(404).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions/:sid/select ──

  app.post<{
    Params: { sid: string };
    Body: {
      methodology_id: string;
      selected_method_id: string;
    };
  }>("/api/methodology/sessions/:sid/select", async (request, reply) => {
    try {
      const { methodology_id, selected_method_id } = request.body ?? {} as any;
      if (!methodology_id || !selected_method_id) {
        return reply.status(400).send({ error: "methodology_id and selected_method_id are required" });
      }
      const result = store.select(request.params.sid, methodology_id, selected_method_id);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not found") || msg.includes("not in methodology")) {
        return reply.status(404).send({ error: msg });
      }
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions/:sid/load-method ──

  app.post<{
    Params: { sid: string };
    Body: {
      method_id: string;
    };
  }>("/api/methodology/sessions/:sid/load-method", async (request, reply) => {
    try {
      const { method_id } = request.body ?? {} as any;
      if (!method_id) {
        return reply.status(400).send({ error: "method_id is required" });
      }
      const result = store.loadMethodInSession(request.params.sid, method_id);
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology session active")) return reply.status(404).send({ error: msg });
      if (msg.includes("not found") || msg.includes("not in methodology")) {
        return reply.status(404).send({ error: msg });
      }
      if (msg.includes("Cannot load method")) return reply.status(409).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/methodology/sessions/:sid/transition ──

  app.post<{
    Params: { sid: string };
    Body: {
      completion_summary?: string;
      challenge_predicates?: Record<string, boolean>;
    };
  }>("/api/methodology/sessions/:sid/transition", async (request, reply) => {
    try {
      const { completion_summary, challenge_predicates } = request.body ?? {} as any;
      const result = store.transition(
        request.params.sid,
        completion_summary ?? null,
        challenge_predicates,
      );
      return reply.status(200).send(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("No methodology session active")) return reply.status(404).send({ error: msg });
      if (msg.includes("Cannot transition")) return reply.status(409).send({ error: msg });
      return reply.status(500).send({ error: msg });
    }
  });
}
