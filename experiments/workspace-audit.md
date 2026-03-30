
# Workspace Salience Audit Report

## Overview
Analysis of `packages/pacta/src/cognitive/algebra/workspace.ts` - a cognitive workspace implementation with salience-based entry management and capacity-constrained eviction.

## Salience Scoring Algorithm

### Components
The default salience function (`defaultSalienceFunction`) uses a weighted combination of three factors:

```typescript
salience = 0.4 * recency + 0.3 * source + 0.3 * goal
```

#### 1. Recency Score (`recencyScore`)
- **Formula**: `Math.exp(-age / 60000)` where age = now - entry.timestamp
- **Behavior**: Exponential decay with 1-minute half-life
- **Range**: [0, 1], with newer entries scoring higher

#### 2. Source Priority (`sourcePriority`)
- **Formula**: Lookup from `sourcePriorities` map, default 0.5
- **Behavior**: Static priority assigned per module
- **Range**: User-defined via configuration

#### 3. Goal Overlap (`goalOverlap`)
- **Formula**: Word overlap ratio between entry content and active goals
- **Behavior**: Simple string tokenization and set intersection
- **Range**: [0, 1], normalized by goal word count

## Eviction Strategy

### Primary Strategy: Lowest-Salience Eviction
- Entries are evicted when workspace reaches capacity
- Selection criteria: lowest salience score
- Tie-breaking: FIFO (oldest entry evicted first)
- Epsilon tolerance: 0.001 for salience comparison

### Secondary Strategy: TTL Expiration
- Entries automatically expire based on TTL configuration
- Default TTL applied if entry-specific TTL not set
- TTL checking occurs on read/write operations

## Critical Weaknesses

### 1. **Computational Inefficiency in Salience Recomputation**
**Severity**: High
**Issue**: Salience is recomputed for ALL entries on every read/write operation
```typescript
function recomputeSalience(now: number): void {
  const ctx: SalienceContext = { ...salienceContext, now };
  for (const entry of entries) {  // O(n) on every operation
    const computed = salienceFn(entry, ctx);
    entry.salience = Number.isFinite(computed) ? computed : 0;
  }
}
```
**Impact**: O(n) complexity per operation leads to poor performance as workspace grows
**Recommendation**: Implement lazy evaluation or cache salience values with invalidation

### 2. **Naive Goal Overlap Algorithm**
**Severity**: Medium-High
**Issue**: Word overlap uses simple string splitting and set intersection
```typescript
const contentWords = new Set(contentStr.toLowerCase().split(/\s+/));
const goalWords = new Set(goals.join(' ').toLowerCase().split(/\s+/));
```
**Problems**:
- No semantic understanding (synonyms, related concepts ignored)
- Vulnerable to stop words contaminating scores
- JSON.stringify() for non-string content creates artificial word matches
- Case-insensitive but no stemming or lemmatization
**Impact**: Poor relevance scoring leading to suboptimal attention allocation
**Recommendation**: Implement semantic similarity (word embeddings, TF-IDF, or NLP models)

### 3. **Race Conditions in Concurrent Access**
**Severity**: Medium
**Issue**: No synchronization mechanisms for concurrent read/write operations
**Problems**:
- Multiple modules can simultaneously modify the workspace
- Salience recomputation and entry addition/removal not atomic
- TTL expiration during read operations can affect concurrent writes
**Impact**: Data corruption, inconsistent state, unpredictable evictions
**Recommendation**: Implement proper locking or immutable data structures

### 4. **Unbounded Memory Growth in Logging**
**Severity**: Medium
**Issue**: Write log and eviction log grow indefinitely
```typescript
const writeLog: WriteLogEntry[] = [];
const evictions: EvictionInfo[] = [];
```
**Impact**: Memory leak in long-running systems
**Recommendation**: Implement log rotation or bounded circular buffers

## Additional Observations

### Strengths
- Clean separation of concerns with read/write ports
- Configurable salience function allowing customization
- Comprehensive logging for observability
- Per-module write quotas prevent abuse

### Minor Issues
- Magic numbers in salience weights (0.4, 0.3, 0.3) not configurable
- No validation of salience function return values beyond finite check
- SALIENCE_EPSILON constant may be too large for high-precision scenarios

## Risk Assessment

1. **Performance Degradation**: High risk in systems with large workspaces (>1000 entries)
2. **Attention Misallocation**: Medium risk due to poor semantic understanding
3. **System Instability**: Medium risk from potential race conditions
4. **Resource Exhaustion**: Low-medium risk from unbounded logging

## Recommendations

1. **Immediate**: Implement salience caching with smart invalidation
2. **Short-term**: Replace goal overlap with semantic similarity algorithm
3. **Medium-term**: Add concurrency control mechanisms
4. **Long-term**: Consider event-sourcing architecture for better observability and consistency

---
*Audit completed: Focus areas identified for cognitive workspace optimization*
