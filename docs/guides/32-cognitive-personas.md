---
guide: 32
title: "Cognitive Personas"
domain: pacta
audience: [agent-operators, contributors]
summary: >-
  Dynamic reasoning style injection — built-in personas, auto-selection, and persona module usage.
prereqs: [26, 27]
touches:
  - packages/pacta/src/cognitive/config/personas.ts
  - packages/pacta/src/cognitive/modules/persona-module.ts
---

# Guide 32 — Cognitive Personas

Personas inject distinct reasoning styles into the cognitive cycle's system prompt. Instead of a one-size-fits-all reasoning approach, the agent adopts a persona suited to the current task — a debugger for fault isolation, an architect for structural reasoning, a reviewer for consistency checks.

This is PRD 032, P4. All persona logic is deterministic (zero LLM calls).

## Why Personas Matter

LLM reasoning quality varies with framing. A prompt that says "systematically isolate the fault" produces different reasoning traces than one that says "explore edge cases broadly." Personas formalize this by encoding named reasoning styles with declared strengths and known biases.

Each persona provides:

- **reasoningStyle** — injected into the system prompt to steer reasoning behavior
- **expertise** — domains the persona excels at
- **strengths** — cognitive advantages of this style
- **biases** — known blind spots (surfaced to the agent for self-correction)

## Built-in Personas

Five personas ship with `@methodts/pacta`:

| Persona | Reasoning Mode | Best For |
|---------|---------------|----------|
| `debugger` | Systematic fault isolation, bisect causal chains | Bug fixes, error analysis, reproduction |
| `architect` | Top-down structural reasoning, tradeoff analysis | System design, refactoring, planning |
| `reviewer` | Critical assessment, consistency checking | Code review, audits, validation |
| `explorer` | Divergent exploration, hypothesis generation | Research, brainstorming, discovery |
| `specialist` | Deep domain-focused, standard compliance | Implementation, specification work |

## Auto-Selection

The persona module scans the top-5 highest-salience workspace entries for task-type keywords and maps them to personas:

| Keywords | Persona |
|----------|---------|
| `debug`, `fix`, `error`, `bug`, `troubleshoot` | debugger |
| `design`, `architect`, `refactor`, `restructure`, `plan` | architect |
| `review`, `audit`, `check`, `validate`, `lint` | reviewer |
| `explore`, `research`, `investigate`, `discover`, `brainstorm` | explorer |
| `implement`, `standard`, `comply`, `specification`, `domain` | specialist |

Selection is case-insensitive. The most frequently occurring keyword wins. If no keyword matches, the configured `defaultPersona` is used (or no persona is active).

## Using the Persona Module

### Direct Module Usage

```typescript
import { createPersonaModule } from '@methodts/pacta/cognitive/modules/persona-module.js';

const personaModule = createPersonaModule(writePort, {
  defaultPersona: 'architect',   // fallback when auto-selection finds no match
  autoSelect: true,              // scan workspace for task signals (default: true)
  guidanceSalience: 0.85,        // salience of guidance entries written to workspace
});
```

### Explicit Persona Override

Force a specific persona via the control directive, bypassing auto-selection:

```typescript
const result = await personaModule.step(
  { snapshot: workspaceSnapshot },
  currentState,
  { forcePersona: 'debugger' },   // override auto-selection
);
// result.output.selectionMethod === 'explicit'
```

### Mid-Task Switching

The persona module detects when the task type changes between cycles. If the workspace signals shift from "debug" keywords to "design" keywords, the module switches from `debugger` to `architect` and writes fresh guidance. The `switched` flag and `switchCount` in state track this.

## Programmatic Access

```typescript
import { selectPersona, getPersona, PERSONAS } from '@methodts/pacta/cognitive/config/personas.js';

// Select by task type string
const persona = selectPersona('debug this API error');
// => { id: 'debugger', name: 'Debugger', ... }

// Get by ID
const architect = getPersona('architect');

// List all personas
Object.values(PERSONAS);
```

## Monitoring

The persona module emits `PersonaModuleMonitoring` signals each cycle:

```typescript
{
  type: 'persona',
  source: 'persona',
  activePersonaId: 'debugger',
  switched: true,
  detectedTaskType: 'debug',
  selectionMethod: 'auto',
}
```

## Key Files

- `packages/pacta/src/cognitive/config/personas.ts` — persona registry and selection logic
- `packages/pacta/src/cognitive/modules/persona-module.ts` — cognitive module implementation
