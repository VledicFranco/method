# PRD Design Notes — bridge-cluster

## Tier: heavyweight
## Phase: 1 (Discovery)

### Layer 1: WHY

- Q1 (Problem): The bridge is single-node. Work cannot be distributed across machines. When mission-control is at capacity (10 sessions, CPU-bound), excess work queues or fails. Other machines on the Tailscale mesh sit idle. There is no mechanism for bridges to discover each other, share state, or route work to the best-resourced node.

- Q2 (Who): The human operator running agents across multiple machines. Also: orchestrator agents (Genesis, strategy pipelines) that need to allocate work to the best available bridge.

- Q3 (Evidence): PRD 038 establishes multi-machine bridge deployment. The bridge pool has a hard MAX_SESSIONS limit (default 10) and no cross-node capacity sharing. Guide 15 documents single-machine access only. The event bus has a WebhookConnector that can POST to external URLs — the outbound federation surface already exists.

- Q4 (Cost of inaction): Capacity ceiling on a single machine. No failover — if mission-control goes down, all agents die. Manual coordination when using multiple machines.

- Q5 (Urgency): Follows naturally from PRD 038. Once bridges are deployable on multiple machines, the coordination problem is immediate.

### Layer 2: WHAT

- Q6 (Solution): Three new components: (1) @methodts/cluster — L3 package with transport-agnostic cluster protocol (membership, resource reporting, work routing). (2) domains/cluster/ — L2 domain in the bridge that integrates the cluster library with the event bus, pool, and health endpoints. (3) method-ctl — L4 CLI application for cluster management. Phased: Tailscale-backed discovery first, SWIM-lite gossip second, work routing third.

- Q7 (Alternatives): See PRD Section 4.

- Q8 (Out of scope): Multi-user auth, cloud deployment, automatic code deployment/CI, split-brain resolution beyond simple majority, cross-cluster routing.

- Q9 (Success): An orchestrator can query cluster state and route a strategy execution to the bridge with the most available capacity. method-ctl shows unified health across all bridges. Event federation makes remote bridge events visible locally.

- Q10 (Acceptance criteria): See PRD AC section.

### Assumptions (PO not available for Q&A)

- [ASSUMPTION] Scale: 2-5 machines in the next 6 months. Gossip protocol is educational and future-proof but Tailscale-backed discovery is the pragmatic first step.
- [ASSUMPTION] No shared filesystem. Each machine has its own git clones. Project identity is by git remote URL + project name.
- [ASSUMPTION] Work routing starts client-side (CLI/orchestrator picks the bridge), evolves to server-side forwarding.
- [ASSUMPTION] Tailscale discovery first, SWIM-lite gossip later.

### Open Markers
(none — assumptions flagged above)
