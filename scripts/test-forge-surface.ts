/**
 * test-forge-surface — Multi-run validation of M-FORGE-SURFACE.
 *
 * Runs the 7-step forge-surface method against real Claude for one or more
 * domain pairs, producing typed port interfaces and co-design records.
 *
 * Usage:
 *   npx tsx scripts/test-forge-surface.ts
 *   npx tsx scripts/test-forge-surface.ts --pair sessions projects
 *   npx tsx scripts/test-forge-surface.ts --model sonnet --budget 0.50
 */

import { parseArgs } from "node:util";
import { Effect } from "effect";

import { ClaudeHeadlessProvider } from "../packages/methodts/src/provider/claude-headless.js";
import { AgentProvider } from "../packages/methodts/src/provider/agent-provider.js";
import { runMethod } from "../packages/methodts/src/runtime/run-method.js";
import { worldState } from "../packages/methodts/src/testkit/builders/state.js";
import { validateAxioms } from "../packages/methodts/src/domain/domain-theory.js";
import { evaluate } from "../packages/methodts/src/predicate/evaluate.js";
import type { Step, WorldState } from "../packages/methodts/src/index.js";
import type { RunMethodError } from "../packages/methodts/src/index.js";
import {
  M_FORGE_SURFACE,
  makeInitialState,
  type ForgeSurfaceState,
} from "./methods/m-forge-surface.js";

// ── ANSI ───────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", blue: "\x1b[34m",
};
const ok     = (s: string) => `${c.green}${s}${c.reset}`;
const fail   = (s: string) => `${c.red}${s}${c.reset}`;
const dim    = (s: string) => `${c.dim}${s}${c.reset}`;
const bold   = (s: string) => `${c.bold}${s}${c.reset}`;
const cyan   = (s: string) => `${c.cyan}${s}${c.reset}`;
const blue   = (s: string) => `${c.blue}${s}${c.reset}`;

// ── Args ────────────────────────────────────────────────────────────────────────

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    pair:   { type: "string",  multiple: true },
    model:  { type: "string",  default: "haiku" },
    budget: { type: "string",  default: "0.50" },
    hint:   { type: "string",  default: "" },
  },
  allowPositionals: true,
});

const model  = args.model  as string;
const budget = parseFloat(args.budget as string);
const hint   = args.hint   as string;

// ── Domain pairs ───────────────────────────────────────────────────────────────

type DomainPair = { domainA: string; domainB: string; hint?: string };

const DEFAULT_PAIRS: DomainPair[] = [
  { domainA: "sessions",    domainB: "projects",   hint: "sessions emit lifecycle events; projects needs to track them" },
  { domainA: "methodology", domainB: "strategies", hint: "strategies execute steps that need methodology definitions" },
  { domainA: "tokens",      domainB: "genesis",    hint: "genesis orchestrates sub-agents and needs token usage from each" },
];

function resolvePairs(): DomainPair[] {
  // --pair sessions projects (multiple --pair flags allowed)
  const pairFlags = args.pair as string[] | undefined;
  if (pairFlags && pairFlags.length >= 2) {
    const pairs: DomainPair[] = [];
    for (let i = 0; i + 1 < pairFlags.length; i += 2) {
      pairs.push({ domainA: pairFlags[i], domainB: pairFlags[i + 1], hint: hint || undefined });
    }
    return pairs;
  }
  // positionals: npx tsx ... sessions projects
  if (positionals.length >= 2) {
    return [{ domainA: positionals[0], domainB: positionals[1], hint: hint || undefined }];
  }
  return DEFAULT_PAIRS;
}

// ── Step log ──────────────────────────────────────────────────────────────────

type StepLog = {
  id: string;
  name: string;
  tag: "agent" | "script";
  status: string;
  tokens: number;
  usd: number;
  ms: number;
  response?: string;
  error?: string;
};

// ── Executor ──────────────────────────────────────────────────────────────────

function buildExecutor(logs: StepLog[]) {
  return (
    step: Step<ForgeSurfaceState>,
    stepState: WorldState<ForgeSurfaceState>,
  ): Effect.Effect<WorldState<ForgeSurfaceState>, RunMethodError, AgentProvider> => {
    return Effect.gen(function* () {
      process.stdout.write(`  ${dim("▶")} [${step.id}] ${bold(step.name)}...`);
      const start = Date.now();

      if (step.execution.tag === "script") {
        const newValue = yield* (
          step.execution.execute(stepState.value) as unknown as Effect.Effect<
            ForgeSurfaceState, { message?: string }, never
          >
        ).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError",
            methodId: M_FORGE_SURFACE.id,
            stepId: step.id,
            message: (e as { message?: string }).message ?? "Script failed",
          })),
        );

        const axiomResult = validateAxioms(M_FORGE_SURFACE.domain, newValue);
        if (!axiomResult.valid) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} axiom violation\n`);
          logs.push({ id: step.id, name: step.name, tag: "script", status: "axiom_violation", tokens: 0, usd: 0, ms });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: M_FORGE_SURFACE.id, stepId: step.id,
            message: `Axiom: ${axiomResult.violations.join(", ")}`,
          });
        }
        if (!evaluate(step.postcondition, newValue)) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} postcondition failed\n`);
          logs.push({ id: step.id, name: step.name, tag: "script", status: "postcondition_failed", tokens: 0, usd: 0, ms });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: M_FORGE_SURFACE.id, stepId: step.id,
            message: `Postcondition failed: ${step.id}`,
          });
        }

        const ms = Date.now() - start;
        process.stdout.write(` ${ok("✓")} ${dim(`(${ms}ms)`)}\n`);
        logs.push({ id: step.id, name: step.name, tag: "script", status: "completed", tokens: 0, usd: 0, ms });
        return { value: newValue, axiomStatus: axiomResult };

      } else {
        // Agent step
        const provider = yield* AgentProvider;
        const ctx = {
          state: stepState.value,
          world: {} as Record<string, string>,
          insights: {} as Record<string, string>,
          domainFacts: "",
        };
        const promptText = step.execution.prompt.run(ctx as never);

        const agentResult = yield* provider.execute({ prompt: promptText }).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError", methodId: M_FORGE_SURFACE.id, stepId: step.id,
            message: `Agent error: ${e._tag}`,
          })),
        );

        const newValue = yield* step.execution.parse(agentResult.raw, stepState.value).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError", methodId: M_FORGE_SURFACE.id, stepId: step.id,
            message: `Parse error: ${(e as { message?: string }).message ?? "unknown"}`,
          })),
        );

        const axiomResult = validateAxioms(M_FORGE_SURFACE.domain, newValue);
        if (!axiomResult.valid) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} axiom violation\n`);
          logs.push({ id: step.id, name: step.name, tag: "agent", status: "axiom_violation", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, response: agentResult.raw });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: M_FORGE_SURFACE.id, stepId: step.id,
            message: `Axiom: ${axiomResult.violations.join(", ")}`,
          });
        }
        if (!evaluate(step.postcondition, newValue)) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} postcondition failed\n`);
          logs.push({ id: step.id, name: step.name, tag: "agent", status: "postcondition_failed", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, response: agentResult.raw });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: M_FORGE_SURFACE.id, stepId: step.id,
            message: `Postcondition failed: ${step.id}`,
          });
        }

        const ms = Date.now() - start;
        process.stdout.write(
          ` ${ok("✓")} ${dim(`${agentResult.cost.tokens}tok $${agentResult.cost.usd.toFixed(4)} (${ms}ms)`)}\n`,
        );
        logs.push({ id: step.id, name: step.name, tag: "agent", status: "completed", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, response: agentResult.raw });
        return { value: newValue, axiomStatus: axiomResult };
      }
    });
  };
}

// ── Single run ────────────────────────────────────────────────────────────────

type RunResult = {
  pair: DomainPair;
  objectiveMet: boolean;
  finalState?: ForgeSurfaceState;
  stepLogs: StepLog[];
  totalMs: number;
  totalTokens: number;
  totalUsd: number;
  errorMessage?: string;
};

async function runPair(pair: DomainPair, runIndex: number, totalRuns: number): Promise<RunResult> {
  const label = `${pair.domainA} ↔ ${pair.domainB}`;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${bold(`Run ${runIndex + 1}/${totalRuns}`)} — ${cyan(label)}`);
  if (pair.hint) console.log(`  ${dim(`Hint: ${pair.hint}`)}`);
  console.log();

  const initial  = worldState<ForgeSurfaceState>(makeInitialState(pair));
  const provider = ClaudeHeadlessProvider({ model, maxBudgetUsd: budget, workdir: process.cwd() });
  const logs: StepLog[] = [];

  const startTime = Date.now();
  let finalState: ForgeSurfaceState | undefined;
  let objectiveMet = false;
  let errorMessage: string | undefined;

  try {
    const executor = buildExecutor(logs);
    const result   = await Effect.runPromise(
      runMethod(M_FORGE_SURFACE, initial, executor).pipe(Effect.provide(provider)),
    );
    finalState   = result.finalState.value;
    objectiveMet = result.objectiveMet;
  } catch (e) {
    errorMessage = (e as Error).message ?? String(e);
  }

  const totalMs     = Date.now() - startTime;
  const totalTokens = logs.reduce((s, r) => s + r.tokens, 0);
  const totalUsd    = logs.reduce((s, r) => s + r.usd, 0);

  // Surface summary
  if (finalState) {
    console.log(`\n  ${bold("Surface")}  ${cyan(finalState.surfaceName || dim("(unnamed)"))}`);
    if (finalState.direction)    console.log(`  Direction  ${finalState.direction}`);
    if (finalState.dataFlowDesc) console.log(`  Flow       ${dim(finalState.dataFlowDesc)}`);
    if (finalState.producer)     console.log(`  Producer   ${finalState.producer}`);
    if (finalState.consumer)     console.log(`  Consumer   ${finalState.consumer}`);
    if (finalState.portFilePath) console.log(`  Port file  ${dim(finalState.portFilePath)}`);
    if (finalState.coDesignRecordPath) console.log(`  Record     ${dim(finalState.coDesignRecordPath)}`);
  }

  // Step table
  console.log(`\n  ${bold("Steps")}\n`);
  for (const log of logs) {
    const tag    = log.tag === "agent" ? blue("agent ") : dim("script");
    const status = log.status === "completed" ? ok("✓") : fail("✗");
    const cost   = log.tag === "agent"
      ? dim(`${log.tokens}tok $${log.usd.toFixed(4)}`)
      : dim("—");
    console.log(`  ${status} ${tag}  ${log.name.padEnd(24)} ${cost}  ${dim(`${log.ms}ms`)}`);
    if (log.status !== "completed" && log.error) {
      console.log(`        ${fail(log.error)}`);
    }
  }

  console.log();
  console.log(`  Tokens: ${totalTokens > 0 ? String(totalTokens) : dim("0")}`);
  console.log(`  Cost:   ${totalUsd > 0 ? `$${totalUsd.toFixed(5)}` : dim("$0.00")}`);
  console.log(`  Time:   ${(totalMs / 1000).toFixed(1)}s`);

  if (errorMessage) console.log(`\n  ${fail("Error:")} ${dim(errorMessage)}`);

  const badge = objectiveMet ? ok("PASS") : fail("FAIL");
  console.log(`\n  Objective: ${badge}`);

  return { pair, objectiveMet, finalState, stepLogs: logs, totalMs, totalTokens, totalUsd, errorMessage };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pairs = resolvePairs();

  console.log(`
${bold("═══════════════════════════════════════════════════════════")}
  ${bold("pv-method")} ${dim("/")} test-forge-surface
  Method: ${cyan("M-FORGE-SURFACE")} — Port Interface Co-Design
  Model:  ${cyan(model)}
  Budget: $${budget.toFixed(2)} per run
  Runs:   ${pairs.length} domain pair${pairs.length > 1 ? "s" : ""}
${bold("═══════════════════════════════════════════════════════════")}`);

  const results: RunResult[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const result = await runPair(pairs[i], i, pairs.length);
    results.push(result);
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${bold("Final Summary")}\n`);

  const passed = results.filter(r => r.objectiveMet).length;
  const total  = results.length;

  for (const r of results) {
    const label = `${r.pair.domainA} ↔ ${r.pair.domainB}`;
    const badge = r.objectiveMet ? ok("✓") : fail("✗");
    const surface = r.finalState?.surfaceName ? cyan(r.finalState.surfaceName) : dim("—");
    const cost = `$${r.totalUsd.toFixed(4)}`;
    console.log(`  ${badge}  ${label.padEnd(30)} ${surface.padEnd(20)} ${dim(cost)}  ${dim(`${(r.totalMs/1000).toFixed(1)}s`)}`);
  }

  console.log();
  console.log(`  Passed: ${passed}/${total}`);
  const grandTokens = results.reduce((s, r) => s + r.totalTokens, 0);
  const grandUsd    = results.reduce((s, r) => s + r.totalUsd, 0);
  console.log(`  Total tokens: ${grandTokens}`);
  console.log(`  Total cost:   $${grandUsd.toFixed(5)}`);
  console.log();

  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(fail("Unexpected error:"), e);
  process.exit(1);
});
