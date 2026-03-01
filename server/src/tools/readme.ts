import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const README = `# method — LLM Reference

method is an MCP server that enforces cognitive methodologies at runtime. You cannot skip
phases, self-report completion, or advance without submitting structured output that passes
validation. The server delivers guidance, validates your output, and controls what comes next.

---

## Quick Start

\`\`\`
1. method_list
   → discover available methodologies

2. method_start(name, topic)
   → returns session_id + Phase 0 guidance in the tool response

3. Guidance arrives in the tool response body. Read it. Execute the phase.

4. method_advance(session_id, phase_output)
   → fail: failed_invariants listed, guidance repeated, session stays on current phase
   → pass: delta rises, next phase guidance delivered
   → final pass: session_complete: true

5. Repeat step 4 until complete.
\`\`\`

**Critical:** copy field names verbatim from the guidance's "Use these exact field names:"
block. Spelling errors cause hard failures with no partial credit.

---

## Tools

### method_list
No arguments. Returns all methodologies: name, description, phase count, phase names.

### method_start(name, topic, [project])
- \`name\` — methodology name from method_list
- \`topic\` — session subject; substituted as \`{{topic}}\` in phase guidance
- \`project\` — optional slug; groups sessions under a project; created automatically if the slug doesn't exist yet

Returns: \`session_id\`, \`current_phase\`, \`total_phases\`, \`delta\`, \`guidance\` for Phase 0.

### method_advance(session_id, phase_output)
\`phase_output\` is a flat JSON object. Keys must exactly match the current phase's
output_schema field names. Check the guidance for the "Use these exact field names:" block.

**Validation failed:**
\`\`\`json
{
  "error": "phase_invariant_failed",
  "current_phase": 0,
  "current_phase_name": "Context Loading",
  "failed_invariants": [
    { "id": "prior_methodologies_min_one", "description": "prior_methodologies must list at least one existing methodology" }
  ],
  "soft_warnings": [],
  "message": "Phase 0 (Context Loading) has 1 unmet requirement(s). Fix the issues and resubmit.",
  "guidance": "<phase 0 guidance repeated>"
}
\`\`\`

**Advanced:**
\`\`\`json
{
  "advanced_to_phase": 1,
  "current_phase_name": "Objective Setting",
  "delta": 0.17,
  "status": "active",
  "invariants_passed": ["prior_methodologies_min_one", "summary_non_empty"],
  "soft_warnings": [],
  "guidance": "<phase 1 guidance>"
}
\`\`\`

**Session complete:**
\`\`\`json
{
  "session_complete": true,
  "methodology": "method-iteration",
  "delta": 1.0,
  "status": "complete",
  "soft_warnings": [],
  "message": "All 6 phases complete. Session closed."
}
\`\`\`

### method_status(session_id)
Use when you need to recall where you are in a session.
\`\`\`json
{
  "session_id": "sess_abc123",
  "methodology": "method-iteration",
  "status": "active",
  "current_phase": 2,
  "current_phase_name": "Design",
  "total_phases": 6,
  "delta": 0.33,
  "completed_phases": [0, 1],
  "context": { "topic": "..." }
}
\`\`\`

### method_reload
Rescans \`server/src/methodologies/*.yaml\` and upserts to DB. Call after manually
editing or adding a YAML file on disk. No server restart needed.
Does NOT reload compiled TypeScript — server code changes require a docker rebuild.

### method_import(yaml_content)
Parses and validates a raw YAML string, persists to DB, immediately available.
Survives server restarts. Does not write to disk.

Success: \`{ "imported": "my-methodology", "phases": 3, "available": [...] }\`
Failure: \`{ "error": "yaml_parse_error" | "schema_validation_error", "message": "..." }\`
Nothing is written if validation fails.

---

## Available Methodologies

### method-iteration — 6 phases
Context Loading → Objective Setting → Design → Implementation → Validation → Decide

The default methodology for bounded product work. Key gates: Phase 1 requires ≥3
falsifiable \`acceptance_criteria\` and ≥2 \`priority_questions\`. Phase 4 requires real test
runs (\`sessions_run\` must be a number ≥ 1). Phase 5 \`decision\` must be exactly \`"stop"\` or \`"continue"\`.

**Use for:** any iteration producing a concrete artifact — code, doc, methodology YAML.

### epoch-open — 3 phases
Theme → Experiments → Commit

Produces \`hypothesis_md_content\` in Phase 2 — complete markdown to write to \`hypothesis.md\`.
Phase 1 forces separate \`experiment_names\` and \`measurable_criteria\` arrays, making it
structurally impossible to spec an experiment without a falsifiable "how we'll know."

**Use for:** opening a new epoch before running its experiments.

### epoch-close — 3 phases
Experiment Outcomes → Retrospective → Forward

Produces \`decision_md_content\` in Phase 2 — complete markdown for \`decision.md\`.
Phase 0 requires one \`experiment_outcomes\` entry per experiment. Open experiments need
a disposition in \`open_experiments\`: \`slug → deferred|promoted|superseded: rationale\`.

**Use for:** closing an epoch after enough experiments have resolved.

### research-team — 7 phases
Context Loading → Architect — Forethought → Scout — Territory Mapping
→ Researcher — Deep Dive → Critic — Challenge → Synthesizer — Integration
→ Architect — Stop/Continue

Multi-role research loop. Each phase has a named cognitive role. Structured for evidence
gathering, critique, and synthesis — not for producing artifacts.

**Use for:** deep research tasks. For artifact-producing work, use method-iteration.

### goal-directed-loop — 6 phases
Context Loading → Objective Setting → Expectation Measurement → Strategy → Evaluation → Iteration

General-purpose structured work loop. Foundation that research-team builds on.

### test-ping — 2 phases
Smoke test. Use to verify the server is reachable and sessions can complete.

### test-gates — 4 phases
Exercises every validation type: string, array min/max, number range, enum, soft invariants.
Use to understand how the validator behaves.

---

## Methodology YAML — Complete Format

\`\`\`\`yaml
name: my-methodology          # unique; used in method_start
description: "..."            # shown in method_list
version: "0.1.0"
phases:
  - id: 0                     # 0-indexed integer
    name: "Phase Name"
    role: null                # string or null — shown in guidance header
    guidance: |
      ## Phase 0 — Phase Name

      What to do here. Use {{topic}} to reference the session subject.

      ### Tasks
      - Task one
      - Task two

      ### Output Fields
      \`\`\`
      field_name   — string: what this captures
      other_field  — array of strings, min 2: what this captures
      \`\`\`

      **Use these exact field names:** \`field_name\`, \`other_field\`

      **Submit when:** both fields are populated and specific.
    output_schema:
      field_name:
        type: string          # string | array | number | boolean
        min_length: 1         # minimum length (default 1)
        description: "..."
      other_field:
        type: array
        items: string         # element type label — documentation only, not validated
        min_items: 2          # enforced minimum count
        max_items: 10         # optional maximum count
        description: "..."
      enum_field:
        type: string
        enum: ["stop", "continue"]   # valid values — exact match, case-sensitive
        description: "..."
      soft_field:
        type: string
        min_length: 1
        description: "optional encouraged field"
    invariants:
      - id: field_name_non_empty       # convention: {field_name}_{constraint}
        description: "field_name must be non-empty"
        hard: true                     # true = blocks advance; false = warns only
      - id: other_field_min_two
        description: "other_field must contain at least 2 items"
        hard: true
      - id: soft_field_present
        description: "soft_field is encouraged"
        hard: false                    # appears in soft_warnings, does not block
\`\`\`\`

### Field type constraints

| type | constraints |
|------|-------------|
| \`string\` | \`min_length\` (default 1), \`enum\` |
| \`array\` | \`min_items\`, \`max_items\`, \`items\` (label only — not enforced) |
| \`number\` | \`min_value\`, \`max_value\` |
| \`boolean\` | — |

\`enum\` validates the field value as a string against the list. Use with \`string\` type only.

### Template variables in guidance

| Variable | Value |
|----------|-------|
| \`{{topic}}\` | topic from method_start |
| \`{{role}}\` | phase role field (or \`—\` if null) |
| \`{{phase_id}}\` | phase id integer |
| \`{{phase_name}}\` | phase name string |
| \`{{total_phases}}\` | total phase count |

Unrecognised variables pass through unchanged: \`{{unknown}}\` → \`{{unknown}}\`.

### How invariants match violations

The validator finds an invariant whose \`id\` starts with the field name. If no match:
defaults to \`hard: true\` with id \`{field_name}_required\`. Name invariants
\`{field_name}_{constraint}\` — e.g. \`criteria_min_three\`, \`decision_valid\`.

### Delta

\`delta = completed_phases.length / total_phases\`. Rises monotonically from 0.0 to 1.0.
It measures phase completion, not quality.

---

## Designing a Methodology

### Phase design rules

1. **One cognitive mode per phase.** Planning, executing, and evaluating belong in
   separate phases. Do not mix generating and critiquing.

2. **Use array fields for enumerable items, not strings.** \`key_decisions: array\` forces
   the agent to enumerate discrete items. \`summary: string\` allows vague blobs that pass
   min_length with a single sentence. If the output is a list of things, make it an array.

3. **Hard invariants enforce the minimum, not the ideal.** Three criteria is the minimum
   for falsifiability. Setting it to ten makes the methodology unusable in practice.

4. **End with a stop/continue decision.** Forces an explicit judgment. Creates the
   iteration loop. Without it, sessions just trail off at delta=1.0.

5. **"Use these exact field names:" in every guidance block.** The single most
   effective thing you can do to prevent field name errors at runtime.

### Canonical phase patterns

**Context Loading (phase 0) — inventory before action:**
\`\`\`yaml
prior_work: { type: array, min_items: 1 }
summary:    { type: string, min_length: 1 }
\`\`\`
Prevents agents from re-deriving what already exists. Invariant: \`prior_work_min_one\` (hard).

**Objective Setting — falsifiability gate:**
\`\`\`yaml
acceptance_criteria: { type: array, items: string, min_items: 3 }
priority_questions:  { type: array, items: string, min_items: 2 }
change_type:         { type: string, enum: ["methodology", "infrastructure", "both"] }
\`\`\`

**Artifact-producing phase — session output is the artifact:**
\`\`\`yaml
hypothesis_md_content: { type: string, min_length: 1 }
\`\`\`
Produce the complete artifact text as an output field. Copy it directly to disk.
No separate writing step needed.

**Stop/Continue decision (last phase):**
\`\`\`yaml
decision:        { type: string, enum: ["stop", "continue"] }
rationale:       { type: string, min_length: 1 }
next_hypothesis: { type: string, min_length: 1 }
\`\`\`
Give \`next_hypothesis\` a \`hard: false\` invariant — it appears in \`soft_warnings\` but does not block.

Note: these are compact inline forms. See the Complete Format section for full YAML syntax.

---

## Common Failure Modes

**Wrong field name** — Most common error. \`learnings\` fails when schema says \`key_learnings\`.
Copy names verbatim from "Use these exact field names:". Do not paraphrase.

**Array below minimum** — \`criteria: ["one"]\` fails when \`min_items: 3\`.
\`criteria: []\` also fails. Populate to at least the minimum count.

**Wrong enum value** — \`decision: "Stop"\` fails when enum is \`["stop", "continue"]\`.
Enum matching is exact and case-sensitive.

**Omitted field** — A field absent from phase_output is treated as null and fails the
non-null check. Include every required field explicitly, even if the value is an empty
array (where min_items: 0).

**Wrong phase's fields** — On phase 0, submitting phase 3 fields means phase 0's
expected fields are absent — they fail. Call \`method_status\` if unsure what phase you're on.
`;

export function registerReadme(server: McpServer): void {
  server.tool(
    'method_readme',
    'Returns the complete method reference for LLMs: all tools, response shapes, available methodologies, YAML format, phase design rules, and common failure modes. Call this once at the start of a session to become expert on method.',
    {},
    async () => ({
      content: [{ type: 'text' as const, text: README }],
    }),
  );
}
