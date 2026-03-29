# PRD Design Notes — Cognitive Modules v2 (035, 036, 037)

## Tier: Heavyweight (3 PRDs, cross-algebra changes, new modules)
## Phase: 3 (Specify) — Discovery complete via deep review + neuroscience research

### Layer 1: WHY
- Q1 (Problem): Cognitive modules have coarse monitoring (scalar confidence), no affect, no principled memory consolidation, no curiosity/exploration, and no impasse detection. Agents can't detect when stuck (2025 LRM research, OpenReview). Existing modules are first-generation implementations with ad-hoc heuristics.
- Q2 (Who): Developers building cognitive agents with pacta. Internal experiments. Future users of the module catalog.
- Q3 (Evidence): Deep review of all modules (2026-03-28). Neuroscience research report (tmp/20260328-cognitive-architecture-research.md). MAP architecture (Nature Comms 2025) validated modular approach: 74% on Tower of Hanoi vs 11% zero-shot.
- Q4 (Cost of inaction): Agents remain stuck without detection. Memory doesn't consolidate across sessions. No exploration when exploiting fails. Competitive cognitive architecture libraries will surpass us.
- Q5 (Urgency): PRD 030 foundation is complete and implemented. PRD 031-032 are proposed but not yet implemented — this is the window to influence the v2 design before those ship.

### Layer 2: WHAT
- Q6 (Solution): 3 PRDs delivering 6 module iterations + 3 new modules as plug-and-play components
- Q7 (Alternatives): (a) Monolithic PRD — rejected, too large. (b) Per-module PRDs — rejected, too granular, misses thematic coherence. (c) 3 thematic PRDs — selected.
- Q8 (Out of scope): Theory of Mind module, CLARION drive system, SOAR chunking/compilation, Cycle v2 (10-phase), OpenCog economic attention, unified factor graph representation
- Q9 (Success): Module parity with ACT-R/SOAR validated mechanisms. Measurable improvement in agent task completion. Clean plug-and-play composition.
- Q10 (Acceptance criteria): See individual PRDs.

### Layer 3: HOW
- Q11 (Dependencies): All depend on PRD 030 (implemented). Independent of each other.
- Q12 (Risks): Interface bloat, over-engineering for LLM agents, composition explosion, performance regression
- Q13 (Rollout): Phased per PRD. v1 modules preserved. v2 modules opt-in.
- Q14 (Monitoring): Trace records, cognitive events, workspace metrics
- Q15 (Rollback): v1 modules remain available. No breaking changes.

### Layer 4: CONSTRAINTS
- Q16 (Appetite): 3-5 days per PRD implementation
- Q17 (NFRs): <50ms overhead per module step (excluding LLM calls). Zero breaking changes to existing API.
- Q18 (Cross-cutting): FCA compliance, backwards compatibility, test coverage >80%

### Architecture
- All modules implement CognitiveModule<I,O,S,Mu,Kappa> — same generic contract
- Versioned factory functions: createMonitorV2(), createMemoryV3(), createAffectModule()
- Composition presets: baselinePreset (v1), enrichedPreset (v2 core), fullPreset (all modules)
- Layer: L3 (@method/pacta) — pure library, no transport dependencies
- No new ports needed — modules use existing ProviderAdapter, ToolProvider, MemoryPort

### Research References
- Full report: tmp/20260328-cognitive-architecture-research.md
- Proposals: tmp/20260328-cognitive-module-proposals.md
