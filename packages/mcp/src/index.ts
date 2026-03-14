import { resolve } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createSession,
  listMethodologies,
  loadMethodology,
  lookupTheory,
} from "@method/core";

// Path resolution
const ROOT = process.env.METHOD_ROOT ?? process.cwd();
const REGISTRY = resolve(ROOT, "registry");
const THEORY = resolve(ROOT, "theory");

// Session singleton
const session = createSession();

// Input schemas
const loadInput = z.object({
  methodology_id: z.string().describe("Methodology ID (e.g., P0-META)"),
  method_id: z.string().describe("Method ID (e.g., M1-MDES)"),
});

const theoryInput = z.object({
  term: z.string().describe("Term or concept to search for"),
});

// Server
const server = new Server(
  { name: "method", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "methodology_list",
      description:
        "List all available methodologies and methods in the registry with their descriptions.",
      inputSchema: { type: "object" as const, properties: {} },
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
        },
        required: ["methodology_id", "method_id"],
      },
    },
    {
      name: "methodology_status",
      description:
        "Show what method is loaded, the current step, and progress.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "step_current",
      description:
        "Get the full record for the current step: guidance, preconditions, output schema.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "step_advance",
      description:
        "Mark the current step complete and advance to the next step.",
      inputSchema: { type: "object" as const, properties: {} },
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
        },
        required: ["term"],
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
        const { methodology_id, method_id } = loadInput.parse(args);
        const method = loadMethodology(REGISTRY, methodology_id, method_id);
        session.load(method);
        return ok(
          `Loaded ${method.methodId} — ${method.name} (${method.steps.length} steps).\nCall step_current to see the first step.`
        );
      }

      case "methodology_status": {
        const st = session.status();
        return ok(JSON.stringify(st, null, 2));
      }

      case "step_current": {
        const step = session.current();
        return ok(JSON.stringify(step, null, 2));
      }

      case "step_advance": {
        const result = session.advance();
        if (result.nextStep === null) {
          return ok("Method complete. All steps finished.");
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err((e as Error).message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
