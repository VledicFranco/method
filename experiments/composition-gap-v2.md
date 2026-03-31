
> **Superseded by PRD 042** (2026-03-30). The composition gap described below was addressed by extracting modules into `cognitive-modules.ts`. See `docs/arch/cognitive-composition.md`.

# Composition Gap Analysis v2
**Analysis Date:** 2024-12-28  
**Files Analyzed:**
- `packages/bridge/src/domains/sessions/cognitive-provider.ts`
- `packages/pacta/src/cognitive/algebra/composition.ts`
- `packages/pacta/src/cognitive/algebra/tower.ts`

## Summary

The bridge cognitive provider does **not use any** of the composition operators from the cognitive algebra. The provider implements a simple sequential execution pattern but does not leverage the formal composition operators available in the algebra layer.

## Available Composition Operators (from algebra)

The cognitive algebra defines 5 composition operators:

### 1. Sequential (`sequential(A, B)`)
- **Purpose:** A's output feeds B's input (A >> B)
- **Location:** `packages/pacta/src/cognitive/algebra/composition.ts:36`
- **Status:** ❌ **NOT USED**

### 2. Parallel (`parallel(A, B, merge)`)
- **Purpose:** Both execute on same input simultaneously; merge combines outputs (A | B)
- **Location:** `packages/pacta/src/cognitive/algebra/composition.ts:126`
- **Features:** Supports error-aware merging, Promise.all execution
- **Status:** ❌ **NOT USED**

### 3. Competitive (`competitive(A, B, selector)`)
- **Purpose:** Both produce outputs; selector chooses winner (A <|> B)
- **Location:** `packages/pacta/src/cognitive/algebra/composition.ts:266`
- **Features:** Evolutionary selection pattern, automatic fallback on failure
- **Status:** ❌ **NOT USED**

### 4. Hierarchical (`hierarchical(Monitor, Target)`)
- **Purpose:** Monitor reads Target's monitoring signals and issues control directives (Monitor > Target)
- **Location:** `packages/pacta/src/cognitive/algebra/composition.ts:387`
- **Features:** Nelson & Narens metacognitive monitoring/control pattern
- **Status:** ❌ **NOT USED**

### 5. Tower (`tower(module, n)`)
- **Purpose:** Bounded recursive tower of hierarchical self-monitoring
- **Location:** `packages/pacta/src/cognitive/algebra/tower.ts:42`
- **Features:** Up to 3 levels deep, recursive metacognition
- **Status:** ❌ **NOT USED**

## Current Architecture Analysis

The cognitive provider (`cognitive-provider.ts`) implements a **monolithic sequential execution** pattern:

- **Architecture:** Single reasoner-actor loop with workspace persistence
- **Execution:** Linear tool cycles (up to 5 tools per cycle)
- **Monitoring:** Built-in monitor function (inline anomaly detection)
- **Control:** Direct interventions via workspace injection
- **Composition:** No formal composition operators used

### Key Implementation Details:
- Uses workspace for state management across cycles
- Implements impasse detection for stagnation
- Has cost tracking and token management
- Includes intervention budgeting
- All logic is contained within a single `runCycle()` function

## Gap Analysis

### Critical Gaps

1. **No Modularity:** The provider doesn't decompose into composable cognitive modules
2. **No Parallel Processing:** Cannot execute multiple reasoning strategies simultaneously
3. **No Competitive Selection:** Cannot compare multiple approaches and choose the best
4. **No Hierarchical Monitoring:** Monitoring is hardcoded, not a separate composable module
5. **No Meta-cognitive Towers:** No recursive self-monitoring capabilities

### Architectural Implications

The current implementation is:
- ✅ **Functional** - Works for sequential task completion
- ✅ **Optimized** - Direct execution path, minimal overhead
- ❌ **Limited** - Cannot leverage advanced cognitive patterns
- ❌ **Rigid** - Hard to extend with new reasoning strategies
- ❌ **Non-compositional** - Cannot mix and match cognitive behaviors

## Recommendations

### High Priority
1. **Refactor to CognitiveModule Interface:** Break down the provider into composable modules
2. **Implement Competitive Selection:** Allow multiple reasoning strategies to compete
3. **Add Hierarchical Monitoring:** Extract monitor logic into a separate composable module

### Medium Priority
4. **Parallel Tool Execution:** Use parallel composition for independent tool calls
5. **Sequential Tool Chains:** Use sequential composition for dependent operations

### Low Priority
6. **Meta-cognitive Towers:** Experiment with tower composition for complex reasoning tasks

## Implementation Strategy

### Phase 1: Modularization
- Extract reasoner and actor as separate `CognitiveModule` instances
- Maintain current behavior using `sequential(reasoner, actor)`

### Phase 2: Competition
- Implement multiple reasoning strategies
- Use `competitive()` to select best approach per cycle

### Phase 3: Hierarchy
- Extract monitoring logic as separate module
- Use `hierarchical(monitor, target)` for meta-cognitive control

### Phase 4: Advanced Patterns
- Experiment with `parallel()` for simultaneous tool execution
- Test `tower()` for recursive reasoning on complex problems

## Risk Assessment

### Implementation Risks
- **Breaking Changes:** Current API would need modification
- **Performance Overhead:** Composition introduces abstraction cost
- **Complexity:** More complex debugging and maintenance

### Mitigation Strategies
- Implement composition operators as opt-in features
- Maintain backward compatibility with current provider interface
- Start with simple compositions (sequential) before complex ones

## Conclusion

The bridge cognitive provider represents a **complete gap** - none of the formal composition operators are utilized. While the current implementation works, it misses opportunities for:

- Enhanced reasoning through competitive selection
- Improved monitoring through hierarchical composition  
- Better parallelization of independent operations
- Meta-cognitive capabilities through tower composition

The gap represents both a **technical debt** (unused formal algebra) and an **opportunity** (untapped cognitive capabilities).
