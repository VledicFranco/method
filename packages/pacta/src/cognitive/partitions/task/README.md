# partitions/task/ — Task Partition

Goal tracking partition. Stores the agent's current and pending tasks, ordered by priority. Used by the Planner module to determine what to do next and by the Monitor module to track completion.

**Eviction policy:** Priority-based — highest priority entries are retained when capacity is exceeded. Unlike the operational partition (LRU), task entries reflect deliberate goal structure and should not be evicted by recency alone.

**Monitor:** The `task/monitor.ts` module observes task state changes and updates this partition when tasks complete, are created, or are reprioritized.
