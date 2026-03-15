import { resolve } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createSessionManager,
  createMethodologySessionManager,
  listMethodologies,
  loadMethodology,
  getMethodologyRouting,
  lookupTheory,
  selectMethodology,
  validateStepOutput,
  startMethodologySession,
  routeMethodology,
  loadMethodInSession,
  transitionMethodology,
} from "@method/core";

// Path resolution
const ROOT = process.env.METHOD_ROOT ?? process.cwd();
const REGISTRY = resolve(ROOT, "registry");
const THEORY = resolve(ROOT, "theory");
const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:3456';

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof TypeError) {
      // Connection error — retry once after 1s
      await new Promise(r => setTimeout(r, 1000));
      return await fetch(url, init);
    }
    throw e;
  }
}

// Session manager — isolates state by session_id
const sessions = createSessionManager();
const methodologySessions = createMethodologySessionManager();

// Input schemas
const loadInput = z.object({
  methodology_id: z.string().describe("Methodology ID (e.g., P0-META)"),
  method_id: z.string().describe("Method ID (e.g., M1-MDES)"),
  session_id: z.string().optional().describe("Session ID for multi-agent isolation"),
});

const sessionInput = z.object({
  session_id: z.string().optional().describe("Session ID for multi-agent isolation"),
});

const theoryInput = z.object({
  term: z.string().describe("Term or concept to search for"),
  session_id: z.string().optional().describe("Session ID for multi-agent isolation"),
});

// session_id property shared across all tool input schemas
const sessionIdProperty = {
  session_id: {
    type: "string",
    description: "Session ID for multi-agent isolation. Omit for default shared session.",
  },
};

// Server
const server = new Server(
  { name: "method", version: "0.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "methodology_list",
      description:
        "List all available methodologies and methods in the registry with their descriptions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "methodology_load",
      description:
        "Load a method into the active session. Provide methodology_id and method_id.",
      inputSchema: {
        type: "object" as const,
        properties: {
          methodology_id: {
            type: "string",
            description: "Methodology ID (e.g., P0-META)",
          },
          method_id: {
            type: "string",
            description: "Method ID (e.g., M1-MDES)",
          },
          ...sessionIdProperty,
        },
        required: ["methodology_id", "method_id"],
      },
    },
    {
      name: "methodology_status",
      description:
        "Show what method is loaded, the current step, and progress.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "step_current",
      description:
        "Get the full record for the current step: guidance, preconditions, output schema.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "step_advance",
      description:
        "Mark the current step complete and advance to the next step.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "theory_lookup",
      description:
        "Search the formal theory (F1-FTH, F4-PHI) for a term or definition.",
      inputSchema: {
        type: "object" as const,
        properties: {
          term: {
            type: "string",
            description: "Term or concept to search for",
          },
          ...sessionIdProperty,
        },
        required: ["term"],
      },
    },
    {
      name: "methodology_get_routing",
      description:
        "Get the transition function and routing predicates for a methodology. Returns the conditions an agent evaluates to select the right method.",
      inputSchema: {
        type: "object" as const,
        properties: {
          methodology_id: {
            type: "string",
            description: "Methodology ID (e.g., P2-SD)",
          },
          ...sessionIdProperty,
        },
        required: ["methodology_id"],
      },
    },
    {
      name: "step_context",
      description:
        "Get enriched context for the current step — methodology, method, step details, and prior outputs. Designed for prompt composition.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "methodology_select",
      description:
        "Record a routing decision and initialize a methodology-level session. Loads the selected method and tracks the methodology context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          methodology_id: {
            type: "string",
            description: "Methodology ID (e.g., P2-SD)",
          },
          selected_method_id: {
            type: "string",
            description: "Method ID selected by routing (e.g., M1-IMPL)",
          },
          ...sessionIdProperty,
        },
        required: ["methodology_id", "selected_method_id"],
      },
    },
    {
      name: "step_validate",
      description:
        "Validate a sub-agent's output against the current step's output schema and postconditions. Records the output for step_context's prior_step_outputs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          step_id: {
            type: "string",
            description: "ID of the step being validated (must match current step)",
          },
          output: {
            type: "object",
            description: "The output object to validate against the step's schema",
          },
          ...sessionIdProperty,
        },
        required: ["step_id", "output"],
      },
    },
    {
      name: "methodology_start",
      description: "Start a methodology-level session that tracks global state across method transitions. Returns methodology metadata and transition function summary.",
      inputSchema: {
        type: "object" as const,
        properties: {
          methodology_id: {
            type: "string",
            description: "Methodology ID (e.g., P1-EXEC)",
          },
          challenge: {
            type: "string",
            description: "Optional: the challenge being addressed",
          },
          ...sessionIdProperty,
        },
        required: ["methodology_id"],
      },
    },
    {
      name: "methodology_route",
      description: "Evaluate \u03B4_\u03A6 against current state and return the recommended method with routing rationale. Requires an active methodology session.",
      inputSchema: {
        type: "object" as const,
        properties: {
          challenge_predicates: {
            type: "object",
            description: "Pre-evaluated predicate values: { predicate_name: true/false }",
          },
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "methodology_load_method",
      description: "Load a specific method within the active methodology session. Prior method outputs will be available in step_context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          method_id: {
            type: "string",
            description: "Method ID to load (e.g., M1-COUNCIL)",
          },
          ...sessionIdProperty,
        },
        required: ["method_id"],
      },
    },
    {
      name: "methodology_transition",
      description: "Complete the current method and evaluate δ_Φ for the next method. Returns the completed method summary and next method recommendation.",
      inputSchema: {
        type: "object" as const,
        properties: {
          completion_summary: {
            type: "string",
            description: "Optional: agent's summary of what the method achieved",
          },
          challenge_predicates: {
            type: "object",
            description: "Optional: updated predicates for re-routing { predicate_name: true/false }",
          },
          ...sessionIdProperty,
        },
      },
    },
    {
      name: "bridge_spawn",
      description: "Spawn a new Claude Code agent session via the bridge. Supports parent-child session chains with budget enforcement, worktree isolation, and stale detection (PRD 006). Agent identity via nicknames and purpose (PRD 007).",
      inputSchema: {
        type: "object" as const,
        properties: {
          workdir: {
            type: "string",
            description: "Working directory for the spawned agent",
          },
          spawn_args: {
            type: "array",
            items: { type: "string" },
            description: "Optional CLI arguments to pass to the spawned agent",
          },
          initial_prompt: {
            type: "string",
            description: "Optional initial prompt to send to the agent on spawn",
          },
          session_id: {
            type: "string",
            description: "Optional methodology session ID to correlate with the bridge session",
          },
          nickname: {
            type: "string",
            description: "Human-readable agent name. Auto-generated if omitted (methodology-derived or word list fallback).",
          },
          purpose: {
            type: "string",
            description: "Why this agent was spawned (1-2 sentences for operator context).",
          },
          parent_session_id: {
            type: "string",
            description: "Bridge session ID of the parent agent (creates a parent-child chain)",
          },
          depth: {
            type: "number",
            description: "Recursion depth of the spawned agent (0 = root, increments per level)",
          },
          budget: {
            type: "object",
            properties: {
              max_depth: { type: "number", description: "Maximum recursion depth (default: 3)" },
              max_agents: { type: "number", description: "Maximum total agents in chain (default: 10)" },
            },
            description: "Budget constraints for the session chain",
          },
          isolation: {
            type: "string",
            enum: ["worktree", "shared"],
            description: "Isolation mode: 'worktree' creates a git worktree for the agent (prevents git staging conflicts). Default: 'shared'.",
          },
          timeout_ms: {
            type: "number",
            description: "Session stale timeout in milliseconds. Agent marked stale after this, auto-killed at 2x. Default: 30 minutes.",
          },
        },
        required: ["workdir"],
      },
    },
    {
      name: "bridge_prompt",
      description: "Send a prompt to a spawned bridge agent and wait for the response.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID returned by bridge_spawn",
          },
          prompt: {
            type: "string",
            description: "Prompt to send to the bridge agent",
          },
          timeout_ms: {
            type: "number",
            description: "Optional timeout in milliseconds",
          },
        },
        required: ["bridge_session_id", "prompt"],
      },
    },
    {
      name: "bridge_kill",
      description: "Kill a spawned bridge agent session. For worktree sessions, specify worktree_action to control cleanup.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID to kill",
          },
          worktree_action: {
            type: "string",
            enum: ["merge", "keep", "discard"],
            description: "Action for worktree sessions: 'merge' cherry-picks into parent branch, 'keep' leaves on disk, 'discard' removes worktree and branch. Default: 'keep'.",
          },
        },
        required: ["bridge_session_id"],
      },
    },
    {
      name: "bridge_list",
      description: "List all active bridge sessions with status and metadata.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "bridge_progress",
      description: "Report progress from a bridge agent session. Call at natural breakpoints: step transitions, significant work, sub-agent spawns.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID (from spawn or BRIDGE_SESSION_ID env var)",
          },
          type: {
            type: "string",
            enum: ["step_started", "step_completed", "working_on", "sub_agent_spawned"],
            description: "Progress event type",
          },
          content: {
            type: "object",
            description: "Progress details: { methodology?, method?, step?, step_name?, description?, sub_agent_id? }",
          },
        },
        required: ["bridge_session_id", "type"],
      },
    },
    {
      name: "bridge_event",
      description: "Report a lifecycle event from a bridge agent session. Call at lifecycle boundaries: completion, errors, escalations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID (from spawn or BRIDGE_SESSION_ID env var)",
          },
          type: {
            type: "string",
            enum: ["completed", "error", "escalation", "budget_warning"],
            description: "Lifecycle event type",
          },
          content: {
            type: "object",
            description: "Event details: { result?, error_message?, escalation_question?, budget_status? }",
          },
        },
        required: ["bridge_session_id", "type"],
      },
    },
    {
      name: "bridge_read_progress",
      description: "Read progress messages from a child bridge agent session. Uses consumption cursor pattern — pass since_sequence from previous call for incremental updates.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID of the child agent to read progress from",
          },
          since_sequence: {
            type: "number",
            description: "Read messages after this sequence number (0 for full history, or last_sequence from previous call)",
          },
        },
        required: ["bridge_session_id"],
      },
    },
    {
      name: "bridge_read_events",
      description: "Read lifecycle events from a child bridge agent session. Uses consumption cursor pattern — pass since_sequence from previous call for incremental updates.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID of the child agent to read events from",
          },
          since_sequence: {
            type: "number",
            description: "Read events after this sequence number (0 for full history, or last_sequence from previous call)",
          },
        },
        required: ["bridge_session_id"],
      },
    },
    {
      name: "bridge_all_events",
      description: "Read lifecycle events from ALL active bridge sessions. For cross-cutting visibility — council or human oversight of all commissioned work.",
      inputSchema: {
        type: "object" as const,
        properties: {
          since_sequence: {
            type: "number",
            description: "Read events after this sequence number (0 for full history)",
          },
          filter_type: {
            type: "string",
            description: "Optional: filter to specific event type (completed, error, escalation, etc.)",
          },
        },
      },
    },
  ],
}));

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "methodology_list": {
        const entries = listMethodologies(REGISTRY);
        return ok(JSON.stringify(entries, null, 2));
      }

      case "methodology_load": {
        const { methodology_id, method_id, session_id } = loadInput.parse(args);
        const session = sessions.getOrCreate(session_id ?? '__default__');
        const method = loadMethodology(REGISTRY, methodology_id, method_id);
        session.load(method);
        const response = {
          methodologyId: method.methodologyId,
          methodId: method.methodId,
          methodName: method.name,
          stepCount: method.steps.length,
          objective: method.objective ?? null,
          firstStep: { id: method.steps[0].id, name: method.steps[0].name },
          message: `Loaded ${method.methodId} — ${method.name} (${method.steps.length} steps). Call step_current to see the first step.`,
        };
        return ok(JSON.stringify(response, null, 2));
      }

      case "methodology_status": {
        const { session_id } = sessionInput.parse(args);
        const session = sessions.getOrCreate(session_id ?? '__default__');
        const st = session.status();
        return ok(JSON.stringify(st, null, 2));
      }

      case "step_current": {
        const { session_id } = sessionInput.parse(args);
        const session = sessions.getOrCreate(session_id ?? '__default__');
        const step = session.current();
        return ok(JSON.stringify(step, null, 2));
      }

      case "step_advance": {
        const { session_id } = sessionInput.parse(args);
        const session = sessions.getOrCreate(session_id ?? '__default__');
        const result = session.advance();

        // Auto-progress: if running in a bridge session, report step transition
        const bridgeUrl = process.env.BRIDGE_URL;
        const bridgeSessionId = process.env.BRIDGE_SESSION_ID;
        if (bridgeUrl && bridgeSessionId) {
          // Fire-and-forget: don't block step_advance on bridge response
          const progressPayload = (type: string, content: Record<string, unknown>) =>
            fetch(`${bridgeUrl}/sessions/${bridgeSessionId}/channels/progress`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type, content, sender: bridgeSessionId }),
            }).catch(() => { /* non-fatal */ });

          progressPayload('step_completed', {
            methodology: result.methodologyId,
            method: result.methodId,
            step: result.previousStep.id,
            step_name: result.previousStep.name,
          });

          if (result.nextStep) {
            progressPayload('step_started', {
              methodology: result.methodologyId,
              method: result.methodId,
              step: result.nextStep.id,
              step_name: result.nextStep.name,
            });
          }
        }

        return ok(JSON.stringify(result, null, 2));
      }

      case "theory_lookup": {
        const { term } = theoryInput.parse(args);
        const results = lookupTheory(THEORY, term);
        if (results.length === 0) {
          return err(`No matches found for "${term}"`);
        }
        return ok(JSON.stringify(results, null, 2));
      }

      case "methodology_get_routing": {
        const { methodology_id } = z.object({
          methodology_id: z.string(),
          session_id: z.string().optional(),
        }).parse(args);
        const result = getMethodologyRouting(REGISTRY, methodology_id);
        return ok(JSON.stringify(result, null, 2));
      }

      case "step_context": {
        const { session_id } = sessionInput.parse(args);
        const session = sessions.getOrCreate(session_id ?? '__default__');
        const ctx = session.context();
        return ok(JSON.stringify(ctx, null, 2));
      }

      case "methodology_select": {
        const { methodology_id, selected_method_id, session_id } = z.object({
          methodology_id: z.string(),
          selected_method_id: z.string(),
          session_id: z.string().optional(),
        }).parse(args);
        const sid = session_id ?? '__default__';
        const session = sessions.getOrCreate(sid);
        const result = selectMethodology(REGISTRY, methodology_id, selected_method_id, session, sid);
        // Also create a methodology session for backward compatibility (PRD 004)
        try {
          const { session: methSession } = startMethodologySession(REGISTRY, methodology_id, null, sid);
          methSession.currentMethodId = selected_method_id;
          methSession.status = 'executing';
          methodologySessions.set(sid, methSession);
        } catch {
          // Non-critical: if methodology session creation fails, the existing select still works
        }
        return ok(JSON.stringify(result, null, 2));
      }

      case "step_validate": {
        const { step_id, output, session_id } = z.object({
          step_id: z.string(),
          output: z.record(z.unknown()),
          session_id: z.string().optional(),
        }).parse(args);
        const session = sessions.getOrCreate(session_id ?? '__default__');
        const result = validateStepOutput(session, step_id, output);
        return ok(JSON.stringify(result, null, 2));
      }

      case "methodology_start": {
        const { methodology_id, challenge, session_id } = z.object({
          methodology_id: z.string(),
          challenge: z.string().optional(),
          session_id: z.string().optional(),
        }).parse(args);
        const sid = session_id ?? '__default__';
        const { session: methSession, result } = startMethodologySession(
          REGISTRY, methodology_id, challenge ?? null, sid
        );
        methodologySessions.set(sid, methSession);
        return ok(JSON.stringify(result, null, 2));
      }

      case "methodology_route": {
        const { challenge_predicates, session_id } = z.object({
          challenge_predicates: z.record(z.boolean()).optional(),
          session_id: z.string().optional(),
        }).parse(args);
        const sid = session_id ?? '__default__';
        const methSession = methodologySessions.get(sid);
        if (!methSession) {
          throw new Error('No methodology session active. Call methodology_start first.');
        }
        const result = routeMethodology(REGISTRY, methSession, challenge_predicates);
        methodologySessions.set(sid, methSession);
        return ok(JSON.stringify(result, null, 2));
      }

      case "methodology_load_method": {
        const { method_id, session_id } = z.object({
          method_id: z.string(),
          session_id: z.string().optional(),
        }).parse(args);
        const sid = session_id ?? '__default__';
        const methSession = methodologySessions.get(sid);
        if (!methSession) {
          throw new Error('No methodology session active. Call methodology_start first.');
        }
        const session = sessions.getOrCreate(sid);
        const result = loadMethodInSession(REGISTRY, methSession, method_id, session, sid);
        methodologySessions.set(sid, methSession);
        return ok(JSON.stringify(result, null, 2));
      }

      case "methodology_transition": {
        const { completion_summary, challenge_predicates, session_id } = z.object({
          completion_summary: z.string().optional(),
          challenge_predicates: z.record(z.boolean()).optional(),
          session_id: z.string().optional(),
        }).parse(args);
        const sid = session_id ?? '__default__';
        const methSession = methodologySessions.get(sid);
        if (!methSession) {
          throw new Error('No methodology session active. Call methodology_start first.');
        }
        const session = sessions.getOrCreate(sid);
        const result = transitionMethodology(
          REGISTRY, methSession, session,
          completion_summary ?? null, challenge_predicates
        );
        methodologySessions.set(sid, methSession);
        return ok(JSON.stringify(result, null, 2));
      }

      case "bridge_spawn": {
        const { workdir, spawn_args, initial_prompt, session_id, nickname, purpose, parent_session_id, depth, budget, isolation, timeout_ms } = z.object({
          workdir: z.string(),
          spawn_args: z.array(z.string()).optional(),
          initial_prompt: z.string().optional(),
          session_id: z.string().optional(),
          nickname: z.string().optional(),
          purpose: z.string().optional(),
          parent_session_id: z.string().optional(),
          depth: z.number().optional(),
          budget: z.object({
            max_depth: z.number().optional(),
            max_agents: z.number().optional(),
          }).optional(),
          isolation: z.enum(["worktree", "shared"]).optional(),
          timeout_ms: z.number().optional(),
        }).parse(args);

        const body: Record<string, unknown> = { workdir };
        if (spawn_args) body.spawn_args = spawn_args;
        if (initial_prompt) body.initial_prompt = initial_prompt;
        // Auto-correlate methodology session ID
        if (session_id) {
          body.metadata = { methodology_session_id: session_id };
        }
        // PRD 007: agent identity
        if (nickname) body.nickname = nickname;
        if (purpose) body.purpose = purpose;
        // PRD 006: parent-child chain fields
        if (parent_session_id) body.parent_session_id = parent_session_id;
        if (depth !== undefined) body.depth = depth;
        if (budget) body.budget = budget;
        // PRD 006 Component 2: worktree isolation
        if (isolation) body.isolation = isolation;
        // PRD 006 Component 4: stale timeout
        if (timeout_ms !== undefined) body.timeout_ms = timeout_ms;

        try {
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            // Surface structured budget errors from bridge
            if ((errBody as any).error === 'DEPTH_EXCEEDED' || (errBody as any).error === 'BUDGET_EXHAUSTED') {
              throw new Error(`Budget rejected: ${(errBody as any).message}`);
            }
            throw new Error(`Bridge error: ${(errBody as any).error ?? (errBody as any).message ?? res.statusText}`);
          }

          const data = await res.json() as {
            session_id: string;
            nickname: string;
            status: string;
            depth?: number;
            parent_session_id?: string | null;
            budget?: { max_depth: number; max_agents: number; agents_spawned: number };
            isolation?: string;
            worktree_path?: string | null;
            metals_available?: boolean;
          };
          return ok(JSON.stringify({
            bridge_session_id: data.session_id,
            nickname: data.nickname,
            status: data.status,
            depth: data.depth ?? 0,
            parent_session_id: data.parent_session_id ?? null,
            budget: data.budget ?? null,
            isolation: data.isolation ?? 'shared',
            worktree_path: data.worktree_path ?? null,
            metals_available: data.metals_available ?? true,
            message: data.isolation === 'worktree'
              ? `Agent '${data.nickname}' spawned in worktree: ${data.worktree_path}. Metals MCP NOT available. Call bridge_prompt to send work.`
              : `Agent '${data.nickname}' spawned. Call bridge_prompt to send work.`,
          }, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_prompt": {
        const { bridge_session_id, prompt, timeout_ms } = z.object({
          bridge_session_id: z.string(),
          prompt: z.string(),
          timeout_ms: z.number().optional(),
        }).parse(args);

        const body: Record<string, unknown> = { prompt };
        if (timeout_ms !== undefined) body.timeout_ms = timeout_ms;

        try {
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions/${bridge_session_id}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json() as { output: string; timed_out: boolean };
          const charCount = data.output.length;
          return ok(JSON.stringify({
            output: data.output,
            timed_out: data.timed_out,
            message: data.timed_out
              ? "Prompt timed out — partial output returned"
              : `Response received (${charCount} chars)`,
          }, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_kill": {
        const { bridge_session_id, worktree_action } = z.object({
          bridge_session_id: z.string(),
          worktree_action: z.enum(["merge", "keep", "discard"]).optional(),
        }).parse(args);

        try {
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions/${bridge_session_id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worktree_action }),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json() as { session_id: string; killed: boolean; worktree_cleaned?: boolean };
          return ok(JSON.stringify({
            bridge_session_id: data.session_id,
            killed: data.killed,
            worktree_cleaned: data.worktree_cleaned ?? false,
            message: data.worktree_cleaned ? "Session killed, worktree cleaned" : "Session killed",
          }, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_list": {
        try {
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions`);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const bridgeSessions = await res.json() as Array<{
            session_id: string;
            nickname: string;
            purpose: string | null;
            status: string;
            queue_depth: number;
            metadata?: Record<string, unknown>;
            parent_session_id?: string | null;
            depth?: number;
            children?: string[];
            budget?: { max_depth: number; max_agents: number; agents_spawned: number };
          }>;

          const formatted = bridgeSessions.map(s => ({
            bridge_session_id: s.session_id,
            nickname: s.nickname,
            purpose: s.purpose ?? null,
            status: s.status,
            queue_depth: s.queue_depth,
            metadata: s.metadata ?? {},
            methodology_session_id: (s.metadata as any)?.methodology_session_id ?? null,
            parent_session_id: s.parent_session_id ?? null,
            depth: s.depth ?? 0,
            children: s.children ?? [],
            budget: s.budget ?? null,
          }));

          const active = bridgeSessions.filter(s => s.status !== 'dead').length;
          return ok(JSON.stringify({
            sessions: formatted,
            capacity: { active, max: bridgeSessions.length },
            message: `${active} of ${bridgeSessions.length} sessions active`,
          }, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_progress": {
        const { bridge_session_id, type: progressType, content: progressContent } = z.object({
          bridge_session_id: z.string(),
          type: z.enum(["step_started", "step_completed", "working_on", "sub_agent_spawned"]),
          content: z.record(z.unknown()).optional(),
        }).parse(args);

        try {
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions/${bridge_session_id}/channels/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: progressType, content: progressContent ?? {}, sender: bridge_session_id }),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json() as { sequence: number; acknowledged: boolean };
          return ok(JSON.stringify({
            sequence: data.sequence,
            acknowledged: data.acknowledged,
            message: `Progress reported: ${progressType}`,
          }, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_event": {
        const { bridge_session_id, type: eventType, content: eventContent } = z.object({
          bridge_session_id: z.string(),
          type: z.enum(["completed", "error", "escalation", "budget_warning"]),
          content: z.record(z.unknown()).optional(),
        }).parse(args);

        try {
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions/${bridge_session_id}/channels/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: eventType, content: eventContent ?? {}, sender: bridge_session_id }),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json() as { sequence: number; acknowledged: boolean };
          return ok(JSON.stringify({
            sequence: data.sequence,
            acknowledged: data.acknowledged,
            message: `Event reported: ${eventType}`,
          }, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_read_progress": {
        const { bridge_session_id, since_sequence } = z.object({
          bridge_session_id: z.string(),
          since_sequence: z.number().optional(),
        }).parse(args);

        try {
          const qs = since_sequence !== undefined ? `?since_sequence=${since_sequence}` : '';
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions/${bridge_session_id}/channels/progress${qs}`);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json();
          return ok(JSON.stringify(data, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_read_events": {
        const { bridge_session_id, since_sequence } = z.object({
          bridge_session_id: z.string(),
          since_sequence: z.number().optional(),
        }).parse(args);

        try {
          const qs = since_sequence !== undefined ? `?since_sequence=${since_sequence}` : '';
          const res = await fetchWithRetry(`${BRIDGE_URL}/sessions/${bridge_session_id}/channels/events${qs}`);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json();
          return ok(JSON.stringify(data, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      case "bridge_all_events": {
        const { since_sequence, filter_type } = z.object({
          since_sequence: z.number().optional(),
          filter_type: z.string().optional(),
        }).parse(args);

        try {
          const params = new URLSearchParams();
          if (since_sequence !== undefined) params.set('since_sequence', String(since_sequence));
          if (filter_type) params.set('filter_type', filter_type);
          const qs = params.toString() ? `?${params.toString()}` : '';
          const res = await fetchWithRetry(`${BRIDGE_URL}/channels/events${qs}`);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json();
          return ok(JSON.stringify(data, null, 2));
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
          }
          throw e;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err((e as Error).message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
