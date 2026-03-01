# method

> An MCP server that enforces research and cognitive methodologies at runtime.

---

## The Problem

Methodologies exist today as markdown documentation. An LLM reads a `research-team` skill file, acknowledges the phases, then immediately skips Phase 1 (Objective Setting) and jumps straight to searching. The Critic never runs because the LLM felt done. The acceptance criteria were never written. The goal-reaching delta was never measured.

The problem is not comprehension — LLMs understand methodologies fine. The problem is enforcement. Markdown documents have no authority. They are suggestions, not constraints.

**Method is the enforcement layer.** It turns methodology documentation into a running process that governs an LLM session from the outside.

---

## How It Works

### Guidance via Tool Response

The primary communication channel from server to LLM is the **tool response body**. When the LLM calls `method_start` or `method_advance`, the server's response includes a `guidance` field containing the full text for the current phase. This appears in the LLM's conversation context as a normal tool result — it is read and acted upon before the LLM produces its next output.

```
LLM calls method_start("research-team", { topic: "MCP sampling" })
  ↓
  server creates session, renders Phase 0 guidance text
  ↓
  tool response: { session_id, current_phase: 0, guidance: "Phase 0 — Context Loading: ..." }
  ↓
  LLM reads guidance from tool result, executes Phase 0 work
  ↓
LLM calls method_advance(session_id, phase_output)
  ↓
  server validates Phase 0 output against structural invariants
  ↓  (if valid)
  tool response: { advanced_to_phase: 1, guidance: "Phase 1 — Architect: define Be/Do/Motor levels..." }
  ↓  (if invalid)
  tool response: { error: "phase_invariant_failed", failed_invariants: [...], guidance: "Phase 0 still active. ..." }
  ↓
... continues through all phases until session_complete: true
```

Each phase gate is a quality barrier. The session does not advance until the output satisfies the structural invariants for the current phase.

### Structural Invariant Validation (MVP)

Each phase declares an `output_schema` — the fields the LLM must populate in `phase_output`. The validator checks:

- Required fields are present and non-empty
- Array fields meet minimum length requirements
- Enum fields contain only valid values

The LLM cannot advance without satisfying these checks. Because validation is structural, the constraints are hard and unambiguous: an empty array fails, a missing field fails, a wrong enum value fails.

**Why not semantic validation?** Semantic checks (e.g., "are these criteria actually checkable?") require judgment. MVP defers this to V1 via `sampling/createMessage` (LLM-as-judge pattern — see V1 below). For MVP, well-designed guidance text and structural field requirements are sufficient to test the core hypothesis.

### The Server as External Metacognitive Layer

The server is not a passive data store. It:

1. **Observes** — receives and validates phase output before permitting advancement
2. **Controls** — delivers phase-appropriate guidance as part of every gate response
3. **Blocks** — refuses to advance sessions that fail invariant checks

The LLM cannot skip phases, cannot receive guidance out of order, and cannot self-report completion without submitting structured output.

### V1: Sampling as Semantic Judge

In V1, `sampling/createMessage` is used for **invariant evaluation**, not guidance delivery. For soft invariants that require content judgment:

```
server receives phase_output from LLM
  ↓
server fires sampling/createMessage:
  "Given this phase output, does it contain at least 3 independently checkable acceptance criteria?
   Answer: PASS or FAIL, then explain."
  ↓
LLM-as-judge response returned to server
  ↓
server uses PASS/FAIL to gate advancement
```

This is the correct use of sampling inversion: the server calls back into the LLM not to deliver messages, but to run quality evaluation as a subprocess. The original LLM session is unaffected; the judge runs in a separate invocation.

---

## Composability Model

The method library (`docs/methods/`) defines two orthogonal axes:

```
goal-directed-loop    ← WHAT and WHEN (objective, criteria, delta, iteration)
        ×
execution-method      ← HOW (team topology, tools, communication pattern)
```

`method` operationalizes this model at runtime:

- **`goal-directed-loop`** maps to the session lifecycle: phases 0-5, delta tracking, stop/continue decision
- **Execution methods** (`research-team`, `orchestrated-team`, etc.) are YAML definitions loaded at startup, describing each phase's guidance text, output schema, and invariants

A session is an instance of `goal-directed-loop × execution-method`. The LLM supplies the objective and executes within the phases. The server enforces when to advance.

---

## MVP Scope

Four tools. In-memory sessions. Two methodologies.

### Tools

#### `method_list`
List available methodologies with names, descriptions, and phase counts.

```json
// Response
{
  "methodologies": [
    {
      "name": "goal-directed-loop",
      "description": "6-phase base loop: objective → criteria → measure → strategy → evaluate → iterate",
      "phases": 6
    },
    {
      "name": "research-team",
      "description": "goal-directed-loop × (Architect ; Scout ; Researcher ; Critic ; Synthesizer)",
      "phases": 7,
      "team": ["Architect", "Scout", "Researcher", "Critic", "Synthesizer"]
    }
  ]
}
```

#### `method_start(name, params)`
Start a methodology session. Server creates session state, renders Phase 0 guidance, returns session ID and guidance text.

```json
// Input
{ "name": "research-team", "topic": "MCP sampling enforcement patterns" }

// Response
{
  "session_id": "sess_abc123",
  "methodology": "research-team",
  "current_phase": 0,
  "current_phase_name": "Context Loading",
  "total_phases": 7,
  "delta": 0.0,
  "status": "active",
  "guidance": "Phase 0 — Context Loading\n\nLoad all prior work relevant to {{topic}} before any other phase begins. ..."
}
```

#### `method_advance(session_id, phase_output)`
Submit structured output for the current phase. Server validates against the phase's `output_schema` and invariants.

- **Invalid** — returns error with failed invariants, session stays on current phase, guidance for the current phase is repeated
- **Valid, non-final** — advances session, returns next phase guidance
- **Valid, final** — advances session, returns `session_complete: true`

```json
// Input
{
  "session_id": "sess_abc123",
  "phase_output": {
    "prior_documents": ["sota-methodology.md", "sampling.ts", "method-primitives.md"],
    "summary": "Found 3 prior documents covering MCP sampling patterns and methodology primitives."
  }
}

// Response (success, non-final)
{
  "advanced_to_phase": 1,
  "current_phase_name": "Architect — Forethought",
  "delta": 0.14,
  "status": "active",
  "invariants_passed": ["prior_documents_min_one", "summary_non_empty"],
  "guidance": "Phase 1 — Architect: Forethought\n\nDefine the objective at three levels: ..."
}

// Response (success, final phase)
{
  "session_complete": true,
  "delta": 1.0,
  "status": "complete",
  "message": "All phases complete. Session closed."
}

// Response (failure)
{
  "error": "phase_invariant_failed",
  "current_phase": 0,
  "current_phase_name": "Context Loading",
  "failed_invariants": [
    { "id": "prior_documents_min_one", "description": "prior_documents must be a non-empty array" }
  ],
  "guidance": "Phase 0 — Context Loading\n\nLoad all prior work relevant to {{topic}} ..."
}
```

#### `method_status(session_id)`
Current session state.

```json
{
  "session_id": "sess_abc123",
  "methodology": "research-team",
  "status": "active",
  "current_phase": 2,
  "current_phase_name": "Scout — Territory Mapping",
  "total_phases": 7,
  "delta": 0.29,
  "completed_phases": [0, 1],
  "context": { "topic": "MCP sampling enforcement patterns" }
}
```

### Session State (In-Memory, MVP)

```typescript
type SessionStatus = "active" | "complete";

type SessionState = {
  methodology: string;
  status: SessionStatus;
  current_phase: number;
  total_phases: number;
  delta: number;                    // completed_phases / total_phases, rounded to 2 decimal places
  completed_phases: number[];
  context: Record<string, unknown>; // params from method_start (topic, etc.)
  phase_outputs: Record<number, Record<string, unknown>>; // keyed by phase id
};

const sessions = new Map<string, SessionState>();
```

**Delta**: `delta = completed_phases.length / total_phases`, rounded to 2 decimal places. It is a progress indicator, not a quality score. Quality scoring is V1.

Persistent sessions (file-backed, cross-restart) are V1. MVP keeps state in memory only.

### Methodologies in MVP

**`goal-directed-loop`** — 6 phases (0–5):

| Phase | Name | Required Output Fields | Hard Invariants |
|-------|------|----------------------|-----------------|
| 0 | Context Loading | `prior_work: string[]`, `summary: string` | `prior_work` min 1 item |
| 1 | Objective Setting | `be_level: string`, `do_level: string`, `motor_level: string`, `acceptance_criteria: string[]`, `priority_questions: string[]` | `acceptance_criteria` min 3, `priority_questions` min 2 |
| 2 | Expectation Measurement | `criterion_scores: Record<string, string>`, `delta_estimate: number` | all criteria from phase 1 scored, delta 0–1 |
| 3 | Strategy | `actions: Array<{action: string, expected_delta: string}>`, `scope_note: string` | `actions` min 2 |
| 4 | Evaluation | `criterion_changes: string[]`, `delta_estimate: number`, `overall_assessment: string` | delta 0–1 |
| 5 | Iteration | `decision: "stop" \| "continue"`, `rationale: string` | decision is valid enum |

**`research-team`** — 7 phases (0–6), `goal-directed-loop × (Architect ; Scout ; Researcher ; Critic ; Synthesizer)`:

| Phase | Name | Role | Required Output Fields | Hard Invariants |
|-------|------|------|----------------------|-----------------|
| 0 | Context Loading | — | `prior_documents: string[]`, `summary: string` | `prior_documents` min 1 |
| 1 | Architect — Forethought | Architect | `be_level: string`, `do_level: string`, `motor_level: string`, `acceptance_criteria: string[]`, `priority_questions: string[]`, `out_of_scope: string[]` | `acceptance_criteria` min 3, `priority_questions` min 2 |
| 2 | Scout — Territory Mapping | Scout | `sources: string[]`, `coverage_notes: string` | `sources` min 3 |
| 3 | Researcher — Deep Dive | Researcher | `deep_sources: string[]`, `findings: string`, `citations: string[]`, `limitations: string[]` | `deep_sources` 2–4, `limitations` min 1 |
| 4 | Critic — Challenge | Critic | `blocking_challenges: string[]`, `what_stands: string[]` | `blocking_challenges` min 1, `what_stands` min 1 |
| 5 | Synthesizer — Integration | Synthesizer | `synthesis: string`, `blocking_challenges_addressed: string[]`, `delta_assessment: string` | all fields non-empty |
| 6 | Architect — Stop/Continue | Architect | `decision: "stop" \| "continue"`, `rationale: string` | decision is valid enum |

---

## Methodology Definition Format

TypeScript (zod) validates the shape at startup. YAML files hold the phase guidance text and output schema. LLMs can edit YAML files directly to refine phase guidance without touching code.

```
src/
  schema.ts              ← zod MethodologySchema, PhaseSchema (validates shape)
  methodologies/         ← YAML methodology definitions (loaded at startup)
    goal-directed-loop.yaml
    research-team.yaml
```

### YAML Format

```yaml
# src/methodologies/research-team.yaml
name: research-team
description: "goal-directed-loop × (Architect ; Scout ; Researcher ; Critic ; Synthesizer)"
version: "0.1.0"
phases:
  - id: 0
    name: "Context Loading"
    role: null
    guidance: |
      Phase 0 — Context Loading

      Load all prior work relevant to {{topic}} before any other phase begins.
      List every document consulted and what it contributes.
      Do not begin research or analysis — only inventory what already exists.
    output_schema:
      prior_documents:
        type: array
        items: string
        min_items: 1
        description: "List of prior document names or paths consulted"
      summary:
        type: string
        min_length: 1
        description: "What was found and what each document contributes"
    invariants:
      - id: prior_documents_min_one
        description: "prior_documents must be a non-empty array"
        hard: true
      - id: summary_non_empty
        description: "summary must be a non-empty string"
        hard: true

  - id: 1
    name: "Architect — Forethought"
    role: "Architect"
    guidance: |
      Phase 1 — Architect: Forethought

      You are acting as the Architect for topic: {{topic}}.
      Define the objective at three levels:
      - Be level: what identity or values does success embody?
      - Do level: what must this session specifically accomplish?
      - Motor level: what is the concrete, inspectable deliverable?

      Write checkable acceptance criteria. "Comprehensive" is not checkable.
      "Covers at least 4 of the 6 priority questions" is checkable.
      List at least 2 priority research questions.
      Define explicitly what is out of scope.
    output_schema:
      be_level:
        type: string
        min_length: 1
      do_level:
        type: string
        min_length: 1
      motor_level:
        type: string
        min_length: 1
      acceptance_criteria:
        type: array
        items: string
        min_items: 3
        description: "Checkable acceptance criteria — each must be falsifiable"
      priority_questions:
        type: array
        items: string
        min_items: 2
        description: "Priority research questions this session must answer"
      out_of_scope:
        type: array
        items: string
        min_items: 0
        description: "What is explicitly not part of this session"
    invariants:
      - id: acceptance_criteria_min_three
        description: "acceptance_criteria must contain at least 3 items"
        hard: true
      - id: priority_questions_min_two
        description: "priority_questions must contain at least 2 items"
        hard: true
      - id: out_of_scope_present
        description: "out_of_scope should be defined (even if empty array)"
        hard: false
```

### Context Variable Substitution

Guidance text supports `{{variable_name}}` markers. The renderer substitutes from the session context object before delivering the guidance string. Available variables:

| Variable | Source |
|----------|--------|
| `{{topic}}` | `method_start` params |
| `{{role}}` | phase `role` field |
| `{{phase_id}}` | phase `id` |
| `{{phase_name}}` | phase `name` |
| `{{total_phases}}` | methodology phase count |

Prior phase outputs are not substituted directly into guidance text — they are part of the LLM's own conversation history.

### Zod Schema

```typescript
// src/schema.ts
import { z } from 'zod';

export const InvariantSchema = z.object({
  id: z.string(),
  description: z.string(),
  hard: z.boolean(),   // hard = blocks advance; soft = warning only
});

export const OutputFieldSchema = z.object({
  type: z.enum(['string', 'array', 'number', 'boolean']),
  items: z.string().optional(),           // for array type: element type
  min_items: z.number().int().min(0).optional(),
  min_length: z.number().int().min(0).optional(),
  min_value: z.number().optional(),
  max_value: z.number().optional(),
  enum: z.array(z.string()).optional(),   // for enum constraints
  description: z.string().optional(),
});

export const PhaseSchema = z.object({
  id: z.number().int().min(0),
  name: z.string(),
  role: z.string().nullable(),
  guidance: z.string(),
  output_schema: z.record(z.string(), OutputFieldSchema),
  invariants: z.array(InvariantSchema),
});

export const MethodologySchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  phases: z.array(PhaseSchema),
});

export type Methodology = z.infer<typeof MethodologySchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;
```

---

## Project Structure

```
method/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts            ← MCP server entry point (stdio transport)
    ├── server.ts           ← server bootstrap + tool registration
    ├── schema.ts           ← zod MethodologySchema, PhaseSchema, OutputFieldSchema
    ├── methodologies/      ← YAML methodology definitions (loaded at startup)
    │   ├── goal-directed-loop.yaml
    │   └── research-team.yaml
    ├── runtime/            ← session management, guidance rendering, validation
    │   ├── session.ts      ← SessionState type, in-memory Map, delta computation
    │   ├── guidance.ts     ← guidance text rendering + {{variable}} substitution
    │   ├── loader.ts       ← YAML loading, parsing, Zod validation at startup
    │   └── validator.ts    ← structural invariant checking against output_schema
    └── tools/              ← one file per MCP tool
        ├── list.ts         ← method_list
        ├── start.ts        ← method_start
        ├── advance.ts      ← method_advance
        └── status.ts       ← method_status
```

---

## Relationship to Other Work

### `docs/methods/` — The Theory Library

`docs/methods/` (`primitives.md`, `methodologies.md`) is the **specification** of what methodologies are and how they compose. It is written for LLMs to read and understand.

`method` is the **runtime** that operationalizes those specifications. The YAML files in `src/methodologies/` are direct translations of the compositions defined in `methodologies.md` into executable phase definitions with invariants.

When the theory library evolves (a new primitive, a refined invariant), the YAML definitions update accordingly. The server enforces what the library specifies.

### Organon 0.6.0 Roadmap

The 0.6.0 roadmap (`organon/roadmap-to-0.6.0/`) identified enforcement as the key mechanism for turning methodology documentation into methodology practice. `method` is the proof-of-concept for that direction.

If `method` demonstrates that server-enforced methodology phases produce qualitatively better LLM work sessions, the enforcement patterns will be incorporated into the organon methodology — the server becomes the enforcer of `organon-workflow` phases.

### V1 Design Directions

**Semantic validation via sampling** — `sampling/createMessage` used as an LLM-as-judge to evaluate soft invariants that require content judgment (e.g., "are these criteria actually checkable?"). The judge runs in a separate invocation; the original session is unaffected.

**Sub-agent orchestration** — `research-team` in MVP runs in a single LLM session with the server guiding phases sequentially. In V1, each role (Architect, Scout, Researcher, Critic, Synthesizer) can be dispatched as a subagent via Claude Code's Agent tool, with the server managing context relay, output accumulation, and quality gates across agents.

**Persistent sessions** — File-backed, cross-restart session state.

---

## MVP Plan

### Hypothesis

> Server-enforced methodology phases — where the LLM cannot advance without submitting structured output that passes structural invariants — produce more complete and better-structured work sessions than unguided LLM sessions.

The enforcement mechanism to test: **phase gates via tool response**. The LLM can only receive next-phase guidance by first satisfying the current phase's structural requirements.

### What Must Be Built

| File | Responsibility |
|------|---------------|
| `src/schema.ts` | Zod schemas for Methodology, Phase, OutputFieldSchema, Invariant |
| `src/methodologies/goal-directed-loop.yaml` | Full phase definitions: guidance + output_schema + invariants |
| `src/methodologies/research-team.yaml` | Full phase definitions for 7-phase research team |
| `src/runtime/loader.ts` | Read YAML files, parse, validate against Zod schema, return Map |
| `src/runtime/session.ts` | SessionState type, in-memory Map, session ID generation, delta computation |
| `src/runtime/guidance.ts` | Render guidance text with `{{variable}}` substitution |
| `src/runtime/validator.ts` | Check `phase_output` against `output_schema` + invariants, return pass/fail + failed list |
| `src/tools/list.ts` | `method_list` handler |
| `src/tools/start.ts` | `method_start` handler |
| `src/tools/advance.ts` | `method_advance` handler |
| `src/tools/status.ts` | `method_status` handler |
| `src/server.ts` | Bootstrap: load methodologies, create McpServer, register tools, connect stdio |
| `src/index.ts` | Entry point: call `startServer()` |

### Test Cases

Each test is run by opening a fresh Claude Code session with `method` registered as an MCP server, giving Claude the scenario prompt, and observing behavior.

---

#### TC-01: Happy Path — `research-team`

**Prompt to Claude:**
> Use the `method` MCP server to run a research session. Call `method_start` with methodology `research-team` and topic `"how do LLMs handle long-context retrieval"`. Then work through all phases, submitting output at each step with `method_advance`. Show me each phase output you submit and each server response you receive.

**Pass criteria:**
- Claude reads guidance from each tool response and acts on it
- Each `method_advance` call includes correctly structured `phase_output`
- Session advances through all 7 phases and returns `session_complete: true`
- `delta` increases monotonically from 0.0 to 1.0

**What this tests:** Full happy path. Guidance delivery. Phase progression. Terminal state.

---

#### TC-02: Invariant Failure and Recovery

**Prompt to Claude:**
> Call `method_start` with methodology `research-team` and topic `"attention mechanisms"`. For Phase 0, call `method_advance` with an empty `prior_documents` array. Observe the error. Then retry with a valid submission.

**Pass criteria:**
- First `method_advance` returns `error: "phase_invariant_failed"` with `prior_documents_min_one` in `failed_invariants`
- Session remains on phase 0 (not advanced)
- Guidance for phase 0 is re-delivered in the error response
- Second call with a non-empty `prior_documents` array succeeds

**What this tests:** Structural validation blocks advancement. Error response includes guidance repeat. Recovery works.

---

#### TC-03: Phase Skip Attempt

**Prompt to Claude:**
> Call `method_start` with methodology `research-team` and topic `"vector databases"`. Then immediately call `method_advance` with what looks like Phase 3 (Researcher) output — deep sources, findings, etc. — without going through phases 0-2.

**Pass criteria:**
- The server validates against Phase 0's schema, not Phase 3's
- `prior_documents` / `summary` fields are expected; the Researcher fields are ignored or cause structural failure
- Server returns a clear error about what Phase 0 requires

**What this tests:** Server enforces current phase, ignores out-of-order submissions.

---

#### TC-04: `method_status` Mid-Session

**Prompt to Claude:**
> Start a `goal-directed-loop` session on topic `"improving test coverage"`. Complete phases 0 and 1. Then call `method_status` and report what it returns.

**Pass criteria:**
- Status shows `current_phase: 2`, `completed_phases: [0, 1]`, `delta: 0.33`, `status: "active"`
- Context includes `{ topic: "improving test coverage" }`

**What this tests:** Status tool reflects accurate session state mid-run.

---

#### TC-05: `method_list` Discovery

**Prompt to Claude:**
> Call `method_list` and describe the available methodologies. Then pick one and start a session.

**Pass criteria:**
- Response includes both `goal-directed-loop` (6 phases) and `research-team` (7 phases) with descriptions
- Claude can start a session based on the listed names without any additional documentation

**What this tests:** Discovery is sufficient for an uninstructed LLM to begin using the server.

---

#### TC-06: Soft Invariant Warning (non-blocking)

**Prompt to Claude:**
> Run a `research-team` session on topic `"LLM fine-tuning"`. At Phase 1 (Architect), submit output with `out_of_scope` as an empty array.

**Pass criteria:**
- Session advances (soft invariant does not block)
- Response notes the soft invariant warning (`out_of_scope_present`)
- `guidance` for Phase 2 is delivered normally

**What this tests:** Soft invariants warn but do not block. Hard/soft distinction works correctly.

---

### Evaluation Criteria

After running all test cases, evaluate:

1. **Gate integrity** — Did the server successfully block every invalid advance? (TC-02, TC-03)
2. **Guidance delivery** — Did Claude act on the guidance in each tool response, or ignore it? (TC-01)
3. **Phase ordering** — Did the session progress in strict phase order? (TC-01, TC-03)
4. **Terminal state** — Did the final phase return `session_complete: true`? (TC-01)
5. **Usability** — Could Claude use the server from `method_list` alone, without reading this README? (TC-05)

---

## Development Status

**Current:** Scaffold only — README, package.json, tsconfig, stub files. Nothing implemented.

Roadmap:
- [ ] `src/schema.ts` — Zod schemas
- [ ] `src/methodologies/goal-directed-loop.yaml` — full phase definitions
- [ ] `src/methodologies/research-team.yaml` — full phase definitions
- [ ] `src/runtime/loader.ts` — YAML loading + Zod validation
- [ ] `src/runtime/session.ts` — in-memory session map + delta
- [ ] `src/runtime/guidance.ts` — guidance rendering + variable substitution
- [ ] `src/runtime/validator.ts` — structural invariant checking
- [ ] `src/tools/list.ts`, `start.ts`, `advance.ts`, `status.ts`
- [ ] `src/server.ts`, `src/index.ts` — bootstrap
- [ ] Claude Code MCP registration (`claude_desktop_config.json`)
- [ ] V1: semantic validation via `sampling/createMessage`
- [ ] V1: persistent sessions (file-backed)
- [ ] V1: sub-agent orchestration per role
