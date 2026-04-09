# tla/ — TLA+ Compiler

Compiles `Methodology<S>` definitions into TLA+ specifications for formal verification. Generates `.tla` modules that can be model-checked with TLC to verify liveness, safety, and termination properties.

## Components

| Component | Description |
|-----------|-------------|
| `ast.ts` | TLA+ AST types — `TlaModule`, `TlaAction`, `TlaFormula`, `TlaVariable` |
| `compile.ts` | `compileMethodology()` — converts `Methodology<S>` → `TlaModule` AST → `.tla` string |

## Output Structure

The generated TLA+ module encodes:
- **State variables**: world state fields become TLA+ variables
- **Init predicate**: initial world state conditions
- **Actions**: each step becomes a TLA+ action with pre/post conditions
- **Safety properties**: `SafetyBounds` become invariants (`Invariant` formulas)
- **Liveness**: termination conditions become `<>[]` (eventually always) formulas

## Usage

```typescript
import { compileMethodology } from '@method/methodts';

const tla = compileMethodology(myMethodology);
// Write tla.tlaString to a .tla file, then run TLC
```

The TLA+ output is for verification only — it is not executed. The primary execution path is `runMethodology()` in the runtime domain.
