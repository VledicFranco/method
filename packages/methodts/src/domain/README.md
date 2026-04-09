# domain/ — Domain Theory

Formal domain representation from the F1-FTH theory. A `DomainTheory<S>` defines the ontology of a methodology: the sorts (types of entities), function declarations (operations over them), and axioms (invariants that must hold).

## Components

| Component | Description |
|-----------|-------------|
| `DomainTheory<S>` | Typed domain: sorts, function declarations, axioms over world state `S` |
| `SortDecl` | A named entity type in the domain (e.g., `Task`, `Agent`, `Resource`) |
| `FunctionDecl` | An operation over sorts (e.g., `assign(Task, Agent) → Assignment`) |
| `validateAxioms()` | Checks that all axiom predicates hold for a given world state |
| `validateSignature()` | Validates that function declarations are well-formed (sorts exist, arities match) |
| `morphism.ts` | Domain morphisms — structure-preserving maps between domain theories |
| `role.ts` | Role type: a named capability assigned to agents within a domain |

## Design

Domain theories are the ontological layer of the formal model. They describe WHAT exists and WHAT operations are meaningful, without specifying HOW methodology steps execute. The runtime layer (run-methodology.ts) checks axioms before and after each step to enforce domain invariants.
