
> **Superseded by PRD 042** (2026-03-30). Monitor logic was extracted from the inline provider into `BridgeMonitorModule` in `cognitive-modules.ts`. See `docs/arch/cognitive-composition.md` for the current architecture.

# Monitor Audit v3 - Cognitive Provider Intervention Analysis

## Executive Summary

This audit analyzes the Monitor intervention system in `packages/bridge/src/domains/sessions/cognitive-provider.ts` to identify current intervention strategies and gaps for known failure modes.

## Current Monitor Intervention Conditions & Strategies

### 1. Anomaly Detection Conditions
- **Low Confidence Detection**: `prevConf < confThreshold` (default 0.3)
- **Read-Only Stagnation**: `readOnlyRun >= stagThreshold` (default 2 consecutive read-only actions)
- **Intervention Budget Gate**: `interventions < intBudget` (default 5 interventions per prompt)

### 2. Current Intervention Strategies

#### A. Progressive Constraint Strategy (Interventions 1-2)
- **Trigger**: Anomaly detected, interventions < 3
- **Action**: Restrict previous action from being repeated
- **Implementation**: `restricted.push(prevAction)`
- **Workspace Injection**: "Previous approach isn't working. Try a different strategy."

#### B. Reframe Strategy (Interventions 3+)
- **Trigger**: Anomaly detected, interventions >= 3
- **Action**: Force complete re-planning without specific tool restrictions
- **Implementation**: `forceReplan = true`, no tool restrictions
- **Workspace Injection**: "Step back and reconsider the fundamental approach."

#### C. Impasse Detection
- **Trigger**: Identical `toolName + toolInput` across cycles
- **Action**: Workspace injection to break repetitive loops
- **Implementation**: Track `prevToolName` and `prevToolInput`
- **Workspace Injection**: "[IMPASSE] You are repeating the same action with identical input. Try a fundamentally different approach."

#### D. Parse Failure Circuit Breaker
- **Trigger**: `consecutiveFailedParses >= MAX_CONSECUTIVE_FAILED_PARSES` (3)
- **Action**: Early termination with error
- **Implementation**: Tracks no-action/parse-error responses within cycle

#### E. Hard Limits
- **Max Cycles**: `maxCycles` (default 15) - prevents infinite loops at cycle level
- **Max Tools Per Cycle**: `maxToolsPerCycle` (default 5) - prevents tool call explosion
- **Intervention Budget**: `interventionBudget` (default 5) - limits monitor interventions

## Missing Intervention Strategies for Known Failure Modes

### 1. Token Budget Exhaustion Strategy
**Gap Identified**: No intervention for approaching token limits before they cause failures.

**Recommended Strategy**:
- **Condition**: `(promptInputTokens + promptOutputTokens) > (maxOutputTokens * 0.8)`
- **Action**: Switch to summarization mode, compress workspace context
- **Implementation**: Force tool selection toward Read/Grep instead of Write operations
- **Workspace Injection**: "Approaching token limit. Focus on essential information gathering and provide concise responses."

### 2. Workspace Saturation Recovery
**Gap Identified**: No intervention when workspace capacity is exhausted, leading to context loss.

**Recommended Strategy**:
- **Condition**: `ws.getCurrentCapacityUsage() > (wsCapacity * 0.9)`
- **Action**: Trigger workspace cleanup and context compression
- **Implementation**: Remove low-salience entries, summarize redundant information
- **Workspace Injection**: "Workspace near capacity. Consolidating information and focusing on core task objectives."

### 3. No-Action Loop Prevention (Enhanced)
**Gap Identified**: Current system only tracks parse failures, not semantic no-action patterns.

**Recommended Strategy**:
- **Condition**: Detect patterns where agent produces valid format but takes no meaningful action
- **Action**: Force action requirement with tool selection constraints
- **Implementation**: Track "plan without action" or "analysis without execution" patterns
- **Workspace Injection**: "You must take a concrete action this cycle. Analysis alone is insufficient - execute a tool call to make progress."

### 4. Infinite Cycle Detection (Cross-Session)
**Gap Identified**: Current max cycles limit is per-prompt, not cross-session pattern detection.

**Recommended Strategy**:
- **Condition**: Detect recurring task patterns across multiple prompts in session
- **Action**: Session-level intervention with approach diversification
- **Implementation**: Maintain session-level action history hash
- **Workspace Injection**: "Detected recurring pattern across prompts. Try a completely different methodology or request human clarification."

## Risk Assessment

### High Risk Gaps
1. **Token Budget Exhaustion**: Can cause mid-operation failures, especially on large Write operations
2. **Workspace Saturation**: Results in context loss and degraded decision-making

### Medium Risk Gaps  
3. **Enhanced No-Action Detection**: Current system may miss semantic no-action loops
4. **Cross-Session Pattern Detection**: May miss higher-level inefficiency patterns

## Dependencies

### Current Dependencies
- `maxOutputTokens` configuration (currently 8192)
- `workspaceCapacity` configuration (currently 8)  
- `interventionBudget` configuration (currently 5)
- Workspace salience scoring system
- Confidence scoring from LLM adapter

### New Dependencies for Recommendations
- Token usage monitoring API from ProviderAdapter
- Workspace capacity utilization metrics
- Session-level state persistence
- Enhanced action classification system

## Implementation Priority

### Phase 1 (Critical)
1. Token budget exhaustion strategy - prevents hard failures
2. Workspace saturation recovery - prevents context degradation

### Phase 2 (Important)  
3. Enhanced no-action loop prevention - improves efficiency
4. Cross-session pattern detection - prevents macro-level loops

## Configuration Recommendations

### Suggested New Config Parameters
```typescript
export interface CognitiveSessionConfig {
  // Existing parameters...
  tokenBudgetThreshold?: number;        // default 0.8 (80% of maxOutputTokens)
  workspaceSaturationThreshold?: number; // default 0.9 (90% of capacity)
  noActionDetectionDepth?: number;      // default 3 (cycles to analyze for no-action patterns)
  crossSessionHistorySize?: number;    // default 10 (previous prompts to track)
}
```

## Conclusion

The current Monitor implementation provides solid foundation-level interventions for basic failure modes, but lacks sophisticated strategies for resource exhaustion and higher-level pattern detection. The identified gaps represent operational risks that could lead to session failures or inefficient resource utilization.

Priority should be given to implementing token budget and workspace saturation strategies, as these directly impact system stability.
