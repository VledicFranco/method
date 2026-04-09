# config/ — Agent Presets and Thought Patterns

Static configuration for pre-built agent personas and reasoning thought patterns. Used by reference agents and cognitive presets to inject consistent behavioral guidance.

## Components

| Component | Description |
|-----------|-------------|
| `PERSONAS` | Named persona profiles (e.g., `code-expert`, `researcher`, `reviewer`) |
| `PersonaProfile` | Persona shape: name, system prompt fragment, strengths, tool preferences |
| `selectPersona()` | Selects the most appropriate persona for a given task description |
| `formatPersonaPrompt()` | Renders a `PersonaProfile` into a system prompt fragment |
| `thought-patterns.ts` | Pre-built thought pattern strings for common reasoning styles |

## Design

Personas are injected as system prompt fragments — they augment, not replace, the pact's system prompt. The `selectPersona()` function uses keyword matching against the task description for lightweight, fast selection.

This module is configuration-only: no LLM calls, no async, no side effects.
