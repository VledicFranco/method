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
} from "@method/core";

// Path resolution
const ROOT = process.env.METHOD_ROOT ?? process.cwd();
const REGISTRY = resolve(ROOT, "registry");
const THEORY = resolve(ROOT, "theory");

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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err((e as Error).message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
