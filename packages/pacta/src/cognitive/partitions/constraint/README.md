# partitions/constraint/ — Constraint Partition

Hard limits partition. Stores inviolable constraints — things the agent must never do regardless of task context. These entries are **permanent and never evicted**.

The `ConstraintClassifier` module reads this partition before every action decision. If a proposed action matches a constraint entry, the module blocks it and routes the decision back to the Reasoner for an alternative.

**Eviction policy:** Never. Constraints are not transient — removing a constraint mid-session would create a security/safety hole. New constraints can be added; existing ones persist for the session lifetime.

**Monitor:** The `constraint/monitor.ts` module observes and logs constraint evaluation events (match or no-match) for observability.
