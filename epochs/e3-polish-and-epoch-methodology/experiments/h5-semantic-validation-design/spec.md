# H5 — Semantic Validation: `sampling/createMessage` as LLM-as-Judge

**Hypothesis:** `sampling/createMessage` (MCP sampling API) can evaluate content-level
invariants that structural validation cannot catch — specifically whether acceptance
criteria are actually falsifiable, and whether rationales genuinely reference specific
criteria. This closes the gap between structural enforcement and meaningful quality gates.

**Scope for E3:** Design only. Produce a complete spec covering:
- How semantic invariants are declared in phase YAML (new field alongside `invariants`)
- What the judge prompt template looks like
- How pass/fail maps to advancement vs. block (hard/soft distinction preserved)
- Latency and cost implications
- What the server-side implementation surface looks like

**Promotion condition:** If the design surfaces implementation questions that need
their own experiment, H5 promotes to E4 rather than blocking E3 close.

**How we'll know:** A written design spec exists that is complete enough to implement
from in E4 — someone reading it could write the code without further design decisions.

**Methodology:** `method-iteration`
**Change type:** infrastructure (design only — no code written in E3)
