# E4 — semantic-validation

**Theme:** semantic validation quality — content-level invariant enforcement for methodology sessions

## Motivation

Structural validation catches field type and presence errors but cannot evaluate content quality. An agent can submit acceptance_criteria that are not falsifiable ('works well', 'looks good') and pass all hard invariants. The gap between structural compliance and meaningful quality enforcement means low-quality submissions silently pass. MCP sampling/createMessage provides an LLM-as-judge mechanism that can close this gap.

## Success looks like

A method_advance call can be blocked by a content-level semantic check using sampling/createMessage as an LLM judge. Hard and soft semantic invariants are declared in phase YAML alongside structural invariants. The runtime calls the judge only when semantic invariants are present.

## Scope boundaries

E4 does not change structural validation, methodology YAML files, or web UI. It does not introduce new MCP tools. It only adds a semantic invariant layer on top of the existing structural validation in the advance tool.

## Experiments

| Slug | Hypothesis | How we'll know | Methodology |
|------|-----------|----------------|-------------|
| h1-semantic-invariant-schema | semantic invariants can be declared in phase YAML as a new field alongside structural invariants | a phase YAML with semantic_invariants field loads without errors and method_list returns it | method-iteration |
| h2-sampling-integration | sampling/createMessage can evaluate semantic invariants from the advance tool | a method_advance call triggers sampling and returns a semantic failure when content fails | method-iteration |
| h3-semantic-e2e | a vague criterion is blocked while a specific criterion passes the same semantic invariant | two test calls: vague rejected, specific passes | method-iteration |

## Epoch acceptance criteria

1. h1-semantic-invariant-schema confirmed: a phase YAML with semantic_invariants loads without errors
2. h2-sampling-integration confirmed: method_advance triggers sampling/createMessage and returns semantic failures
3. h3-semantic-e2e confirmed: a vague criterion is blocked, a specific criterion passes

## Stopping condition

Close E4 when h3-semantic-e2e passes end-to-end, even if latency/cost experiments are incomplete. The core hypothesis is falsified or confirmed once a real method_advance call is blocked by a semantic invariant.
