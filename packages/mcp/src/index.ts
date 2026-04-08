import { resolve } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { lookupTheory } from "./theory.js";
import { createValidationMiddleware } from "./validate-project-access.js";
import { theoryInput, sessionIdProperty } from "./schemas.js";
import { bridgeHandlers } from "./bridge-tools.js";
import { experimentHandlers, EXPERIMENT_TOOLS } from "./experiment-tools.js";
import { createDefaultFcaIndex } from "@method/fca-index";
import { createContextTools, CONTEXT_TOOLS } from "./context-tools.js";

// Path resolution
const ROOT = process.env.METHOD_ROOT ?? process.cwd();
const THEORY = resolve(ROOT, "theory");
const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:3456';

const BRIDGE_TIMEOUT_MS = parseInt(process.env.BRIDGE_TIMEOUT_MS ?? '30000', 10);

// FCA index — lazy init, fails gracefully if VOYAGE_API_KEY is not set
let contextQueryHandler: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;
let coverageCheckHandler: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
if (VOYAGE_API_KEY) {
  createDefaultFcaIndex({ projectRoot: ROOT, voyageApiKey: VOYAGE_API_KEY })
    .then(fcaIndex => {
      const tools = createContextTools(fcaIndex.query, fcaIndex.coverage, ROOT);
      contextQueryHandler = tools.contextQueryHandler;
      coverageCheckHandler = tools.coverageCheckHandler;
    })
    .catch(e => {
      console.error('[fca-index] Failed to initialize:', e.message);
    });
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    // Only retry on safe (non-mutating) methods to prevent double-fire on POST
    const method = init?.method?.toUpperCase() ?? 'GET';
    if (e instanceof TypeError && (method === 'GET' || method === 'HEAD')) {
      await new Promise(r => setTimeout(r, 1000));
      return await fetch(url, init);
    }
    throw e;
  }
}

async function bridgeFetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  // Add timeout to prevent indefinite hangs if bridge is unresponsive
  // timeoutMs overrides BRIDGE_TIMEOUT_MS (used by bridge_prompt for long cognitive sessions)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? BRIDGE_TIMEOUT_MS);

  let res: Response;
  try {
    const mergedInit = { ...init, signal: controller.signal };
    res = await fetchWithRetry(url, mergedInit);
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof TypeError) {
      throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
    }
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`Bridge error: request timed out after ${BRIDGE_TIMEOUT_MS}ms — bridge may be unresponsive`);
    }
    throw e;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText })) as Record<string, string>;
    const msg = [errBody.error, errBody.message].filter(Boolean).join(': ') || res.statusText;
    throw new Error(`Bridge error: ${msg}`);
  }
  return res;
}

// Project isolation validation middleware (F-SECUR-003)
const validateProjectAccess = createValidationMiddleware();

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
      description: "Spawn a new agent session via the bridge. Supports standard (Claude CLI) and cognitive-agent modes. Set provider_type to 'cognitive-agent' for observable reasoning cycles with tool use, workspace, and monitor interventions. Use llm_provider/llm_config to select Ollama or Anthropic.",
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
          mode: {
            type: "string",
            enum: ["pty", "print"],
            description: "Session mode: 'pty' for interactive PTY with TUI rendering, 'print' for headless structured JSON output via claude --print. Default: 'pty' (or 'print' if PRINT_SESSION_DEFAULT=true).",
          },
          allowed_paths: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns of files this agent is allowed to modify. Empty = no constraint. Requires isolation: 'worktree' for enforcement mode. PRD 014.",
          },
          scope_mode: {
            type: "string",
            enum: ["enforce", "warn"],
            description: "Scope enforcement mode. 'enforce' installs a pre-commit hook (requires worktree). 'warn' emits events only. Default: 'enforce'. PRD 014.",
          },
          provider_type: {
            type: "string",
            enum: ["print", "cognitive-agent"],
            description: "Session type: 'print' for Claude CLI (default), 'cognitive-agent' for cognitive reasoning cycle with observable workspace, monitor, and tools.",
          },
          cognitive_config: {
            type: "object",
            properties: {
              maxCycles: { type: "number", description: "Max reasoning cycles (default: 15)" },
              maxToolsPerCycle: { type: "number", description: "Max tool calls per cycle (default: 5)" },
              workspaceCapacity: { type: "number", description: "Workspace entry capacity (default: 8)" },
              confidenceThreshold: { type: "number", description: "Monitor intervention threshold (default: 0.3)" },
            },
            description: "Configuration for cognitive-agent sessions. Only used when provider_type is 'cognitive-agent'.",
          },
          llm_provider: {
            type: "string",
            enum: ["anthropic", "ollama"],
            description: "LLM provider for cognitive-agent mode. 'anthropic' (default) uses Claude API. 'ollama' uses a local/remote Ollama instance.",
          },
          llm_config: {
            type: "object",
            properties: {
              baseUrl: { type: "string", description: "Base URL for the LLM provider (e.g., 'http://chobits:11434' for Ollama)" },
              model: { type: "string", description: "Model name override (e.g., 'qwen3-coder:30b' for Ollama)" },
            },
            description: "Optional configuration for the selected LLM provider.",
          },
        },
        required: ["workdir"],
      },
    },
    {
      name: "bridge_spawn_batch",
      description: "Spawn multiple Claude Code agent sessions with staggered delays to prevent API rate limit contention (PRD 012). Each session is spawned stagger_ms apart.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sessions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                workdir: {
                  type: "string",
                  description: "Working directory for the spawned agent",
                },
                spawn_args: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional CLI arguments",
                },
                initial_prompt: {
                  type: "string",
                  description: "Optional initial prompt",
                },
                session_id: {
                  type: "string",
                  description: "Optional methodology session ID",
                },
                nickname: {
                  type: "string",
                  description: "Human-readable agent name",
                },
                purpose: {
                  type: "string",
                  description: "Why this agent was spawned",
                },
                parent_session_id: {
                  type: "string",
                  description: "Bridge session ID of the parent agent",
                },
                depth: {
                  type: "number",
                  description: "Recursion depth",
                },
                budget: {
                  type: "object",
                  properties: {
                    max_depth: { type: "number" },
                    max_agents: { type: "number" },
                  },
                },
                isolation: {
                  type: "string",
                  enum: ["worktree", "shared"],
                  description: "Isolation mode",
                },
                timeout_ms: {
                  type: "number",
                  description: "Session stale timeout in milliseconds",
                },
                mode: {
                  type: "string",
                  enum: ["pty", "print"],
                  description: "Session mode: 'pty' or 'print'",
                },
                allowed_paths: {
                  type: "array",
                  items: { type: "string" },
                  description: "Glob patterns of files this agent is allowed to modify. PRD 014.",
                },
                scope_mode: {
                  type: "string",
                  enum: ["enforce", "warn"],
                  description: "Scope enforcement mode. PRD 014.",
                },
              },
              required: ["workdir"],
            },
            description: "Array of session configurations to spawn",
          },
          stagger_ms: {
            type: "number",
            description: "Delay in milliseconds between each spawn (default: 3000)",
          },
        },
        required: ["sessions"],
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
            enum: ["completed", "error", "escalation", "budget_warning", "scope_violation", "stale"],
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
    {
      name: "strategy_execute",
      description: "Start a Strategy pipeline execution. Accepts a Strategy YAML definition (inline or file path) and context inputs. Returns an execution ID for tracking. The strategy DAG runs asynchronously — use strategy_status to poll progress.",
      inputSchema: {
        type: "object" as const,
        properties: {
          strategy_yaml: {
            type: "string",
            description: "Inline Strategy YAML content. Provide this OR strategy_path.",
          },
          strategy_path: {
            type: "string",
            description: "Path to a Strategy YAML file on disk. Provide this OR strategy_yaml.",
          },
          context_inputs: {
            type: "object",
            description: "Values for strategy.context.inputs (e.g., { prd_path: 'docs/prds/017.md' })",
          },
        },
      },
    },
    {
      name: "strategy_dry_run",
      description: "Estimate cost and duration for a strategy DAG using historical observations. Returns p50/p90 cost bands, critical-path duration, and a list of nodes lacking historical data. Useful for operators to understand expected cost before execution.",
      inputSchema: {
        type: "object" as const,
        properties: {
          nodes: {
            type: "array",
            description: "DAG nodes to estimate",
            items: {
              type: "object",
              properties: {
                node_id: { type: "string" },
                methodology_id: { type: "string", description: "Methodology (e.g. P2-SD, P0-META)" },
                model: { type: "string", description: "Model (e.g. claude-opus-4-6)" },
                capabilities: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tool capabilities this node needs",
                },
                prompt_char_count: {
                  type: "number",
                  description: "Estimated prompt length (bucketed into xs/s/m/l/xl)",
                },
              },
              required: ["node_id", "methodology_id", "model"],
            },
          },
          edges: {
            type: "array",
            description: "DAG edges (node -> list of dependency node IDs)",
            items: {
              type: "object",
              properties: {
                node_id: { type: "string" },
                depends_on: { type: "array", items: { type: "string" } },
              },
              required: ["node_id"],
            },
          },
        },
        required: ["nodes", "edges"],
      },
    },
    {
      name: "strategy_status",
      description: "Get the status of a Strategy pipeline execution. Returns node statuses, cost, gate results, artifacts, and retro path when complete.",
      inputSchema: {
        type: "object" as const,
        properties: {
          execution_id: {
            type: "string",
            description: "Execution ID returned by strategy_execute",
          },
        },
        required: ["execution_id"],
      },
    },
    {
      name: "strategy_create",
      description: "Create a new strategy definition YAML file. Writes to .method/strategies/{id}.yaml. The strategy becomes available for execution and trigger registration after creation.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "Strategy ID (alphanumeric + hyphens, normalized to lowercase kebab-case for filename)",
          },
          yaml: {
            type: "string",
            description: "Full strategy YAML content",
          },
        },
        required: ["id", "yaml"],
      },
    },
    {
      name: "strategy_update",
      description: "Update an existing strategy definition by replacing its YAML content. The strategy must already exist.",
      inputSchema: {
        type: "object" as const,
        properties: {
          strategy_id: {
            type: "string",
            description: "Strategy ID to update",
          },
          yaml: {
            type: "string",
            description: "Full replacement YAML content",
          },
        },
        required: ["strategy_id", "yaml"],
      },
    },
    {
      name: "strategy_delete",
      description: "Delete a strategy definition YAML file. Removes the file from .method/strategies/.",
      inputSchema: {
        type: "object" as const,
        properties: {
          strategy_id: {
            type: "string",
            description: "Strategy ID to delete",
          },
        },
        required: ["strategy_id"],
      },
    },
    {
      name: "strategy_reload",
      description: "Force reload all strategy definitions from .method/strategies/. Re-reads all YAML files and returns the new definition count.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "strategy_execution_status",
      description: "Get the full execution state of a strategy pipeline — node results, cost, oversight events, and status. Use this for detailed inspection of a running or completed execution.",
      inputSchema: {
        type: "object" as const,
        properties: {
          execution_id: {
            type: "string",
            description: "Execution ID returned by strategy_execute",
          },
        },
        required: ["execution_id"],
      },
    },
    {
      name: "strategy_resume",
      description: "Resume a suspended strategy execution, optionally with modified context inputs. Only works on executions with status 'suspended' (e.g., after an escalate_to_human oversight rule fired).",
      inputSchema: {
        type: "object" as const,
        properties: {
          execution_id: {
            type: "string",
            description: "Execution ID of a suspended strategy execution",
          },
          modified_inputs: {
            type: "object",
            description: "Optional modified context inputs to use when resuming",
          },
        },
        required: ["execution_id"],
      },
    },
    {
      name: "strategy_abort",
      description: "Abort a running or suspended strategy execution. Sets status to failed with the provided reason.",
      inputSchema: {
        type: "object" as const,
        properties: {
          execution_id: {
            type: "string",
            description: "Execution ID of the strategy execution to abort",
          },
          reason: {
            type: "string",
            description: "Reason for aborting the execution",
          },
        },
        required: ["execution_id"],
      },
    },
    {
      name: "trigger_list",
      description: "List all registered event triggers with status and stats. Optionally filter by strategy ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          strategy_id: {
            type: "string",
            description: "Optional: filter triggers by strategy ID",
          },
        },
      },
    },
    {
      name: "trigger_enable",
      description: "Enable a specific event trigger by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          trigger_id: {
            type: "string",
            description: "Trigger ID to enable (e.g., 'S-CODE-REVIEW:webhook:2')",
          },
        },
        required: ["trigger_id"],
      },
    },
    {
      name: "trigger_disable",
      description: "Disable a specific event trigger without unregistering it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          trigger_id: {
            type: "string",
            description: "Trigger ID to disable (e.g., 'S-CODE-REVIEW:webhook:2')",
          },
        },
        required: ["trigger_id"],
      },
    },
    {
      name: "trigger_pause_all",
      description: "Pause all event triggers (maintenance mode). No triggers will fire until resumed.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "trigger_resume_all",
      description: "Resume all event triggers after maintenance pause.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "trigger_reload",
      description: "Hot-reload strategy trigger registrations from .method/strategies/. Reconciles: registers new, updates changed, unregisters deleted strategies.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "resource_copy_methodology",
      description: "Copy a methodology from a source project to one or more target projects. Reads the source manifest.yaml and copies the methodology entry to target manifests.",
      inputSchema: {
        type: "object" as const,
        properties: {
          source_id: {
            type: "string",
            description: "Source project ID (directory name)",
          },
          method_name: {
            type: "string",
            description: "Methodology ID to copy (e.g., P2-SD)",
          },
          target_ids: {
            type: "array",
            items: { type: "string" },
            description: "Target project IDs (directory names)",
          },
        },
        required: ["source_id", "method_name", "target_ids"],
      },
    },
    {
      name: "resource_copy_strategy",
      description: "Copy a strategy from a source project to one or more target projects. Reads the source manifest.yaml and copies the strategy entry to target manifests.",
      inputSchema: {
        type: "object" as const,
        properties: {
          source_id: {
            type: "string",
            description: "Source project ID (directory name)",
          },
          strategy_name: {
            type: "string",
            description: "Strategy ID to copy",
          },
          target_ids: {
            type: "array",
            items: { type: "string" },
            description: "Target project IDs (directory names)",
          },
        },
        required: ["source_id", "strategy_name", "target_ids"],
      },
    },
    {
      name: "project_list",
      description: "List all discovered projects with their metadata and status.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "project_get",
      description: "Get metadata for a specific project by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project_id: {
            type: "string",
            description: "Project ID",
          },
        },
        required: ["project_id"],
      },
    },
    {
      name: "project_get_manifest",
      description: "Read manifest.yaml from a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project_id: {
            type: "string",
            description: "Project ID",
          },
        },
        required: ["project_id"],
      },
    },
    {
      name: "project_read_events",
      description: "Read project events with cursor-based pagination.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project_id: {
            type: "string",
            description: "Project ID (optional, filters by project)",
          },
          since_cursor: {
            type: "string",
            description: "Cursor from previous read (optional, for pagination)",
          },
        },
      },
    },
    {
      name: "genesis_report",
      description: "Report findings to human. Genesis session only (project_id='root'). Non-Genesis sessions get 403.",
      inputSchema: {
        type: "object" as const,
        properties: {
          message: {
            type: "string",
            description: "Report message",
          },
        },
        required: ["message"],
      },
    },
    // PRD 041: Cognitive Experiment Lab tools
    ...EXPERIMENT_TOOLS,
    // PRD 054: FCA context tools (only available when VOYAGE_API_KEY is set)
    ...(VOYAGE_API_KEY ? CONTEXT_TOOLS : []),
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
    // F-SECUR-003: Validate project isolation for all tool calls
    const validationResult = validateProjectAccess(name, args as Record<string, unknown>);
    if (!validationResult.allowed) {
      const reason = validationResult.reason ?? 'Tool call denied due to project isolation constraints';
      console.warn(`[ISOLATION] Tool call denied: ${reason}`);
      return err(reason);
    }

    switch (name) {
      // theory_lookup stays local — no bridge dependency
      case "theory_lookup": {
        const { term } = theoryInput.parse(args);
        const results = lookupTheory(THEORY, term);
        if (results.length === 0) {
          return err(`No matches found for "${term}"`);
        }
        return ok(JSON.stringify(results, null, 2));
      }

      // All methodology tools are now bridge proxies
      case "methodology_list":
      case "methodology_load":
      case "methodology_status":
      case "step_current":
      case "step_advance":
      case "step_context":
      case "step_validate":
      case "methodology_get_routing":
      case "methodology_start":
      case "methodology_route":
      case "methodology_select":
      case "methodology_load_method":
      case "methodology_transition":
      // Bridge proxy tools — delegated to bridge-tools.ts factory handlers
      case "bridge_spawn":
      case "bridge_spawn_batch":
      case "bridge_prompt":
      case "bridge_kill":
      case "bridge_list":
      case "bridge_progress":
      case "bridge_event":
      case "bridge_read_progress":
      case "bridge_read_events":
      case "bridge_all_events":
      case "strategy_execute":
      case "strategy_dry_run":
      case "strategy_status":
      case "strategy_create":
      case "strategy_update":
      case "strategy_delete":
      case "strategy_reload":
      case "strategy_execution_status":
      case "strategy_resume":
      case "strategy_abort":
      case "trigger_list":
      case "trigger_enable":
      case "trigger_disable":
      case "trigger_pause_all":
      case "trigger_resume_all":
      case "trigger_reload":
      case "resource_copy_methodology":
      case "resource_copy_strategy":
      case "project_list":
      case "project_get":
      case "project_get_manifest":
      case "project_read_events":
      case "genesis_report": {
        const handler = bridgeHandlers[name];
        if (!handler) throw new Error(`Unknown bridge tool: ${name}`);
        return handler(args as Record<string, unknown>, bridgeFetch, BRIDGE_URL);
      }

      // PRD 041: Cognitive Experiment Lab tools
      case "experiment_create":
      case "experiment_run":
      case "experiment_results":
      case "experiment_compare":
      case "lab_list_presets":
      case "lab_describe_module":
      case "lab_read_traces":
      case "lab_read_workspace": {
        const handler = experimentHandlers[name];
        if (!handler) throw new Error(`Unknown experiment tool: ${name}`);
        return handler(args as Record<string, unknown>, bridgeFetch, BRIDGE_URL);
      }

      // PRD 054: FCA context tools
      case 'context_query': {
        if (!contextQueryHandler) return err('context_query unavailable: VOYAGE_API_KEY not set');
        return contextQueryHandler(args as Record<string, unknown>);
      }
      case 'coverage_check': {
        if (!coverageCheckHandler) return err('coverage_check unavailable: VOYAGE_API_KEY not set');
        return coverageCheckHandler(args as Record<string, unknown>);
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
