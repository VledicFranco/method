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
  { name: "method", version: "0.4.0" },
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
      description: "Spawn a new Claude Code agent session via the bridge. Supports parent-child session chains with budget enforcement (PRD 006).",
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
      description: "Kill a spawned bridge agent session.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bridge_session_id: {
            type: "string",
            description: "Bridge session ID to kill",
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
        const { workdir, spawn_args, initial_prompt, session_id, parent_session_id, depth, budget } = z.object({
          workdir: z.string(),
          spawn_args: z.array(z.string()).optional(),
          initial_prompt: z.string().optional(),
          session_id: z.string().optional(),
          parent_session_id: z.string().optional(),
          depth: z.number().optional(),
          budget: z.object({
            max_depth: z.number().optional(),
            max_agents: z.number().optional(),
          }).optional(),
        }).parse(args);

        const body: Record<string, unknown> = { workdir };
        if (spawn_args) body.spawn_args = spawn_args;
        if (initial_prompt) body.initial_prompt = initial_prompt;
        // Auto-correlate methodology session ID
        if (session_id) {
          body.metadata = { methodology_session_id: session_id };
        }
        // PRD 006: parent-child chain fields
        if (parent_session_id) body.parent_session_id = parent_session_id;
        if (depth !== undefined) body.depth = depth;
        if (budget) body.budget = budget;

        try {
          const res = await fetch(`${BRIDGE_URL}/sessions`, {
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
            status: string;
            depth?: number;
            parent_session_id?: string | null;
            budget?: { max_depth: number; max_agents: number; agents_spawned: number };
          };
          return ok(JSON.stringify({
            bridge_session_id: data.session_id,
            status: data.status,
            depth: data.depth ?? 0,
            parent_session_id: data.parent_session_id ?? null,
            budget: data.budget ?? null,
            message: "Agent spawned. Call bridge_prompt to send work.",
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
          const res = await fetch(`${BRIDGE_URL}/sessions/${bridge_session_id}/prompt`, {
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
        const { bridge_session_id } = z.object({
          bridge_session_id: z.string(),
        }).parse(args);

        try {
          const res = await fetch(`${BRIDGE_URL}/sessions/${bridge_session_id}`, {
            method: 'DELETE',
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const data = await res.json() as { session_id: string; killed: boolean };
          return ok(JSON.stringify({
            bridge_session_id: data.session_id,
            killed: data.killed,
            message: "Session killed",
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
          const res = await fetch(`${BRIDGE_URL}/sessions`);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`Bridge error: ${(errBody as any).error ?? res.statusText}`);
          }

          const bridgeSessions = await res.json() as Array<{
            session_id: string;
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err((e as Error).message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
