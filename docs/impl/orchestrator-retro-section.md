# Retrospective Section — Include in All Orchestrator Prompts

> Copy this section into orchestrator prompts. It replaces any prior retrospective
> instructions that referenced tmp/ as the destination.

## Retrospective Protocol (MANDATORY)

This project uses the Retrospective Protocol (RETRO-PROTO, promoted). After completing
each method execution, you MUST produce a retrospective YAML artifact.

### Where to save

Save retrospectives to the **project repo**, NOT to tmp/:

```
.method/retros/retro-YYYY-MM-DD-NNN.yaml
```

One file per method execution. If you run M5-PLAN + M1-IMPL in one session, produce
two retro files (e.g., `retro-2026-03-15-001.yaml` and `retro-2026-03-15-002.yaml`).

These files are **committed to git** (not ephemeral). They are the evidence base for
card and methodology evolution.

### Schema

```yaml
retrospective:
  session_id: "unique-id"
  methodology: P2-SD        # or P1-EXEC, P0-META
  method: "M1-IMPL"         # the method you executed
  method_version: "3.1"
  project_card_id: I2-METHOD # the card you used
  card_version: "1.1"       # version of the card

  hardest_decision:          # MANDATORY
    step: "sigma_N"
    decision: "What you had to decide"
    outcome: "What you did and what happened"
    guidance_gap: true/false  # Was the method's guidance silent on this?

  observations:              # MANDATORY, at least 1
    - step: "sigma_N"
      type: gap | friction | success | surprise
      description: "What happened, concretely"
      evidence: "file:line or file:key-path"
      severity: LOW | MEDIUM | HIGH
      improvement_target: abstract_method | project_card | both | unclear

  card_feedback:             # MANDATORY if a card was used
    - rule_id: DR-NN
      verdict: helpful | unhelpful | missing_coverage | overly_restrictive
      note: "What worked or didn't"
    # Also evaluate the essence section:
    - field: essence.invariant
      verdict: helpful | unhelpful | missing_coverage
      note: "Did the invariant guide your decisions? Was it accurate?"
    - field: essence.optimize_for
      verdict: helpful | unhelpful | missing_coverage
      note: "Did the priority stack resolve any ambiguous tradeoffs?"

  proposed_deltas:           # OPTIONAL — your suggested changes
    - target: abstract_method | project_card
      location: "M1-IMPL sigma_B3 guidance" or "DR-04"
      current: "what it says now"
      proposed: "what it should say"
      rationale: "why"
```

### What makes a good retrospective

- **hardest_decision**: name the actual moment of maximum uncertainty, not a summary
- **observations**: be specific — "sigma_B3 guidance doesn't address X" with evidence, not "things could be better"
- **card_feedback**: test EVERY delivery rule you encountered, including the essence section. Verdicts like `overly_restrictive` or `missing_coverage` are more actionable than `helpful`
- **proposed_deltas**: include `current`/`proposed`/`rationale` — these get applied directly

**Do NOT** produce rote "everything was fine" retrospectives. If you have zero friction and zero gaps, that's suspicious — name at least one thing that surprised you.

### Essence feedback (new)

The project card has an `essence` section with `purpose`, `invariant`, and `optimize_for`. In your card_feedback, evaluate whether:
- The `invariant` guided any of your decisions (and whether it was accurate)
- The `optimize_for` stack resolved any ambiguous tradeoffs
- The `purpose` prevented or should have prevented any scope drift
