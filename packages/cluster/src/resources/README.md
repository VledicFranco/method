# Resources

Resource reporting types and validation for `@methodts/cluster`.

## Files

| File | Purpose |
|------|---------|
| `resource-schema.ts` | Zod validation schema for `ResourceSnapshot`, parse/safeParse utilities |
| `resource-schema.test.ts` | Validation tests |

## ResourceSnapshot

A point-in-time report of a node's available resources. Used by the membership
manager to track peer capacity and by the routing algorithm to score nodes.

Fields: `nodeId`, `instanceName`, `cpuCount`, `cpuLoadPercent`, `memoryTotalMb`,
`memoryAvailableMb`, `sessionsActive`, `sessionsMax`, `projectCount`, `uptimeMs`, `version`.

The canonical type is defined in `../types.ts`. This module re-exports it and
adds Zod validation for runtime input parsing (e.g., data received from peers).
