# stdlib/methods/p2/ — P2-SD Method Definitions

Individual method files for the P2-SD (Software Development) methodology. Each file defines one named `Method<S>` used as an arm in the P2-SD methodology state machine.

| File | Method | Description |
|------|--------|-------------|
| `m1-impl.ts` | M1-IMPL | Implementation from architecture + PRDs (9-step linear DAG) |
| `m2-dimpl.ts` | M2-DIMPL | Directed implementation (shorter path for well-specified tasks) |
| `m3-phrv.ts` | M3-PHRV | Phased review — multi-stage code review with gate checkpoints |
| `m4-ddag.ts` | M4-DDAG | DAG-driven implementation with parallel task execution |
| `m5-plan.ts` | M5-PLAN | Planning method — decomposes PRDs into implementation tasks |
| `m6-arfn.ts` | M6-ARFN | Architecture refinement — evolves architecture under constraints |
| `m7-prds.ts` | M7-PRDS | PRD synthesis — produces structured PRDs from requirements |
