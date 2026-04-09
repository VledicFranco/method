/**
 * @method/bridge — L4 Application Entry Point
 *
 * The bridge is the composition root for the entire method runtime. It:
 *   - Wires all port implementations to their interfaces
 *   - Registers all domain route handlers on the Fastify server
 *   - Owns process lifecycle (startup, recovery, graceful shutdown)
 *
 * server-entry.ts: Main composition root — creates Fastify instance,
 *   registers domains (sessions, build, tokens, strategies, triggers,
 *   registry, methodology, projects, genesis, cost-governor, cluster),
 *   wires the Universal Event Bus (PRD 026) and its sinks.
 *
 * startup-recovery.ts: Recovers orphaned PTY sessions from prior crashes.
 *
 * This package is not imported by other packages — it IS the runnable
 * process. External consumers interact via HTTP or MCP (port 3456 default).
 */

export {};
