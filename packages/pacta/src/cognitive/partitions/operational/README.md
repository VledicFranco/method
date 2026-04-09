# partitions/operational/ — Operational Partition

Execution state partition. Stores transient context about what the agent is currently doing: active tool calls, the current step being executed, recent observations, and short-term working notes.

**Eviction policy:** LRU — least recently accessed entries are evicted first. Operational state is inherently transient; old entries have low predictive value for current actions.

**Monitor:** The `operational/monitor.ts` module observes step execution and tool call events, keeping this partition synchronized with the agent's current action.
