/**
 * run-method — Local method execution playground.
 *
 * Looks up a stdlib method by ID, loads initial state from a JSON file,
 * and runs it with real Claude (or in mock mode for script-only methods).
 *
 * Usage:
 *   npx tsx scripts/run-method.ts --list
 *   npx tsx scripts/run-method.ts --method P2-SD/M5-PLAN --state scripts/states/plan.json
 *   npx tsx scripts/run-method.ts --method P1-EXEC/M3-TMP --state state.json --mock
 *   npx tsx scripts/run-method.ts --method P2-SD/M5-PLAN --state state.json --compile
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Layer } from "effect";

import { getMethod, getStdlibCatalog } from "../packages/methodts/src/stdlib/catalog.js";
import { ClaudeHeadlessProvider } from "../packages/methodts/src/provider/claude-headless.js";
import { AgentProvider } from "../packages/methodts/src/provider/agent-provider.js";
import { runMethod } from "../packages/methodts/src/runtime/run-method.js";
import { worldState } from "../packages/methodts/src/testkit/builders/state.js";
import { SequenceProvider } from "../packages/methodts/src/testkit/provider/recording-provider.js";
import { compileMethod } from "../packages/methodts/src/meta/compile.js";
import { evaluate, validateAxioms } from "../packages/methodts/src/index.js";
import type { Method, Step, WorldState, RunMethodError } from "../packages/methodts/src/index.js";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const ok = (s: string) => `${c.green}${s}${c.reset}`;
const fail = (s: string) => `${c.red}${s}${c.reset}`;
const warn = (s: string) => `${c.yellow}${s}${c.reset}`;
const dim = (s: string) => `${c.dim}${s}${c.reset}`;
const bold = (s: string) => `${c.bold}${s}${c.reset}`;
const cyan = (s: string) => `${c.cyan}${s}${c.reset}`;

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    method:  { type: "string" },
    state:   { type: "string" },
    list:    { type: "boolean", default: false },
    mock:    { type: "boolean", default: false },
    compile: { type: "boolean", default: false },
    model:   { type: "string",  default: "sonnet" },
    budget:  { type: "string",  default: "2" },
    workdir: { type: "string" },
    help:    { type: "boolean", default: false },
  },
  allowPositionals: false,
});

// ── --help ────────────────────────────────────────────────────────────────────

if (args.help) {
  console.log(`
${bold("run-method")} — Local method execution playground

${bold("Usage:")}
  npx tsx scripts/run-method.ts ${cyan("--list")}
  npx tsx scripts/run-method.ts ${cyan("--method")} <METHODOLOGY/METHOD> ${cyan("--state")} <file.json> [options]

${bold("Options:")}
  ${cyan("--method")}   <id>     Method to run  (e.g. P2-SD/M5-PLAN)
  ${cyan("--state")}    <file>   JSON file with initial state (raw value, not wrapped)
  ${cyan("--list")}              Show all available methods and exit
  ${cyan("--mock")}              Use mock provider — no LLM, only script steps execute
  ${cyan("--compile")}           Run G1-G6 gates before executing
  ${cyan("--model")}    <name>   Claude model  (default: sonnet)
  ${cyan("--budget")}   <usd>    Max budget USD (default: 2)
  ${cyan("--workdir")}  <path>   Working directory for Claude (default: cwd)
  ${cyan("--help")}              Show this message

${bold("Examples:")}
  npx tsx scripts/run-method.ts --list
  npx tsx scripts/run-method.ts --method P2-SD/M5-PLAN --state state.json
  npx tsx scripts/run-method.ts --method P1-EXEC/M3-TMP --state state.json --compile --mock
`);
  process.exit(0);
}

// ── --list ────────────────────────────────────────────────────────────────────

if (args.list) {
  const catalog = getStdlibCatalog();
  console.log(`\n${bold("Stdlib Methods")}\n`);
  for (const methodology of catalog) {
    const statusBadge = methodology.status === "compiled" ? ok("compiled") : warn("draft");
    console.log(`  ${bold(methodology.methodologyId)} — ${methodology.name} [${statusBadge}]`);
    for (const m of methodology.methods) {
      const mBadge = m.status === "compiled" ? ok("✓") : warn("~");
      console.log(`    ${mBadge}  ${cyan(`${methodology.methodologyId}/${m.methodId}`)}  ${m.name}  ${dim(`(${m.stepCount} steps, v${m.version})`)}`);
    }
    console.log();
  }
  process.exit(0);
}

// ── Validate required args ────────────────────────────────────────────────────

if (!args.method) {
  console.error(fail("Error: --method is required (or use --list to see available methods)"));
  process.exit(1);
}

const [methodologyId, methodId] = (args.method as string).split("/");
if (!methodologyId || !methodId) {
  console.error(fail(`Error: --method must be in the form METHODOLOGY/METHOD (e.g. P2-SD/M5-PLAN), got: ${args.method}`));
  process.exit(1);
}

// ── Lookup method ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const method = getMethod(methodologyId, methodId) as Method<any> | undefined;
if (!method) {
  console.error(fail(`Error: method not found: ${args.method}`));
  console.error(dim("  Run --list to see all available methods."));
  process.exit(1);
}

// ── Load state ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initialValue: any;

if (args.state) {
  const statePath = resolve(args.state as string);
  try {
    const raw = readFileSync(statePath, "utf-8");
    initialValue = JSON.parse(raw);
  } catch (e) {
    console.error(fail(`Error: could not read state file: ${statePath}`));
    console.error(dim(`  ${(e as Error).message}`));
    process.exit(1);
  }
} else if (!args.mock) {
  console.error(fail("Error: --state <file.json> is required (or use --mock for script-only methods)"));
  process.exit(1);
} else {
  // Mock mode with no state — use empty object
  initialValue = {};
}

const initial = worldState(initialValue);

// ── Header ────────────────────────────────────────────────────────────────────

const modeLabel = args.mock ? warn("mock (no LLM)") : ok(`real (claude ${args.model}, budget $${args.budget})`);
const agentStepCount = method.dag.steps.filter((s) => s.execution.tag === "agent").length;
const scriptStepCount = method.dag.steps.length - agentStepCount;

console.log(`
${bold("═══════════════════════════════════════════════════════════")}
  ${bold("pv-method")} ${dim("/")} run-method
  Method:  ${cyan(`${methodologyId} / ${methodId}`)} — ${method.name}
  Steps:   ${method.dag.steps.length}  ${dim(`(${agentStepCount} agent, ${scriptStepCount} script)`)}
  Mode:    ${modeLabel}
${bold("═══════════════════════════════════════════════════════════")}
`);

// ── --compile ─────────────────────────────────────────────────────────────────

if (args.compile) {
  if (!args.state) {
    console.log(warn("  Skipping --compile: requires --state to provide representative test states for G1/G4.\n"));
  } else {
  process.stdout.write("  Compiling (G1-G6)...");
  const report = compileMethod(method, [initialValue]);
  const overallBadge =
    report.overall === "compiled" ? ok("compiled") :
    report.overall === "needs_review" ? warn("needs_review") : fail("failed");

  console.log(` ${overallBadge}\n`);

  for (const gate of report.gates) {
    const badge =
      gate.status === "pass" ? ok("✓") :
      gate.status === "needs_review" ? warn("~") : fail("✗");
    console.log(`  ${badge}  ${gate.gate.padEnd(20)} ${dim(gate.details)}`);
  }
  console.log();

  if (report.overall === "failed") {
    console.error(fail("  Compilation failed — fix errors before running."));
    process.exit(1);
  }
  } // end else (has state)
}

// ── Build provider ────────────────────────────────────────────────────────────

let providerLayer: Layer.Layer<AgentProvider>;

if (args.mock) {
  const seq = SequenceProvider([]);
  providerLayer = seq.layer;
  if (agentStepCount > 0) {
    console.log(warn(`  Warning: ${agentStepCount} agent step(s) will fail in mock mode (no responses provided).\n`));
  }
} else {
  providerLayer = ClaudeHeadlessProvider({
    model: args.model as string,
    maxBudgetUsd: parseFloat(args.budget as string),
    workdir: args.workdir ? resolve(args.workdir as string) : process.cwd(),
  });
}

// ── Build logging step executor ───────────────────────────────────────────────

type StepLog = { id: string; name: string; status: string; tag: string; tokens: number; usd: number; ms: number; retries: number };
const stepLogs: StepLog[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLoggingExecutor(m: Method<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (step: Step<any>, stepState: WorldState<any>): Effect.Effect<WorldState<any>, RunMethodError, AgentProvider> => {
    return Effect.gen(function* () {
      process.stdout.write(`  ${dim("▶")} [${step.id}] ${step.name}...`);
      const start = Date.now();

      if (step.execution.tag === "script") {
        const newValue = yield* (step.execution.execute(stepState.value) as unknown as Effect.Effect<unknown, { message?: string }, never>).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError",
            methodId: m.id,
            stepId: step.id,
            message: e.message ?? "Script step failed",
          })),
        );

        const axiomResult = validateAxioms(m.domain, newValue);
        if (!axiomResult.valid) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")}  axiom violation (${ms}ms)\n`);
          stepLogs.push({ id: step.id, name: step.name, status: "axiom_violation", tag: "script", tokens: 0, usd: 0, ms, retries: 0 });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
          });
        }

        if (!evaluate(step.postcondition, newValue)) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")}  postcondition failed (${ms}ms)\n`);
          stepLogs.push({ id: step.id, name: step.name, status: "postcondition_failed", tag: "script", tokens: 0, usd: 0, ms, retries: 0 });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: `Postcondition failed for step "${step.id}"`,
          });
        }

        const ms = Date.now() - start;
        process.stdout.write(` ${ok("✓")}  ${dim(`(${ms}ms)`)}\n`);
        stepLogs.push({ id: step.id, name: step.name, status: "completed", tag: "script", tokens: 0, usd: 0, ms, retries: 0 });
        return { value: newValue, axiomStatus: axiomResult } as WorldState<unknown>;

      } else {
        const provider = yield* AgentProvider;
        const ctx = { state: stepState.value, world: {}, insights: {}, domainFacts: "" };
        const promptText = step.execution.prompt.run(ctx as never);

        const agentResult = yield* provider.execute({ prompt: promptText }).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: `Agent error: ${e._tag}`,
          })),
        );

        const newValue = yield* step.execution.parse(agentResult.raw, stepState.value).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: `Parse error: ${(e as { message?: string }).message ?? "unknown"}`,
          })),
        );

        const axiomResult = validateAxioms(m.domain, newValue);
        if (!axiomResult.valid) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")}  axiom violation (${ms}ms)\n`);
          stepLogs.push({ id: step.id, name: step.name, status: "axiom_violation", tag: "agent", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, retries: 0 });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
          });
        }

        if (!evaluate(step.postcondition, newValue)) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")}  postcondition failed (${ms}ms)\n`);
          stepLogs.push({ id: step.id, name: step.name, status: "postcondition_failed", tag: "agent", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, retries: 0 });
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: `Postcondition failed for step "${step.id}"`,
          });
        }

        const ms = Date.now() - start;
        const tokensLabel = agentResult.cost.tokens > 0 ? dim(` ${agentResult.cost.tokens}tok $${agentResult.cost.usd.toFixed(4)}`) : "";
        process.stdout.write(` ${ok("✓")} ${tokensLabel} ${dim(`(${ms}ms)`)}\n`);
        stepLogs.push({ id: step.id, name: step.name, status: "completed", tag: "agent", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, retries: 0 });
        return { value: newValue, axiomStatus: axiomResult } as WorldState<unknown>;
      }
    });
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const m = method!; // guarded above — process.exit(1) if undefined
  console.log(`  ${bold("Steps")}\n`);

  const startTime = Date.now();

  let runStatus: "completed" | "step_failed" | "objective_not_met" = "completed";
  let objectiveMet = false;
  let errorMessage: string | undefined;

  try {
    const executor = buildLoggingExecutor(m);
    const effect = runMethod(m, initial, executor).pipe(
      Effect.provide(providerLayer),
    );

    const result = await Effect.runPromise(effect);
    runStatus = result.status;
    objectiveMet = result.objectiveMet;
  } catch (e) {
    runStatus = "step_failed";
    errorMessage = (e as Error).message ?? String(e);
  }

  const totalMs = Date.now() - startTime;

  // ── Summary ─────────────────────────────────────────────────────────────────

  const totalTokens = stepLogs.reduce((s, r) => s + r.tokens, 0);
  const totalUsd = stepLogs.reduce((s, r) => s + r.usd, 0);

  const statusBadge =
    runStatus === "completed" && objectiveMet ? ok("completed ✓") :
    runStatus === "completed" ? warn("completed (objective not met)") :
    runStatus === "objective_not_met" ? warn("objective not met") :
    fail("failed");

  console.log(`\n  ${bold("Summary")}\n`);
  console.log(`  Status:    ${statusBadge}`);
  console.log(`  Objective: ${objectiveMet ? ok("met") : fail("not met")}`);
  console.log(`  Steps run: ${stepLogs.length} / ${m.dag.steps.length}`);
  console.log(`  Tokens:    ${totalTokens > 0 ? totalTokens.toLocaleString() : dim("0 (script-only)")}`);
  console.log(`  Cost:      ${totalUsd > 0 ? `$${totalUsd.toFixed(4)}` : dim("$0.00")}`);
  console.log(`  Duration:  ${(totalMs / 1000).toFixed(1)}s`);

  if (stepLogs.length > 0) {
    console.log(`\n  ${bold("Step results")}\n`);
    const idW   = Math.max(8,  ...stepLogs.map((r) => r.id.length));
    const nameW = Math.max(10, ...stepLogs.map((r) => Math.min(r.name.length, 32)));
    const hdr = [
      "ID".padEnd(idW),
      "Name".padEnd(nameW),
      "Type".padEnd(7),
      "Status".padEnd(20),
      "Tokens".padStart(7),
      "Cost".padStart(9),
      "Duration".padStart(9),
    ].join("  ");
    console.log(`  ${dim(hdr)}`);
    console.log(`  ${dim("─".repeat(hdr.length))}`);

    for (const r of stepLogs) {
      const statusStr =
        r.status === "completed" ? ok("completed") :
        r.status === "postcondition_failed" ? fail("postcondition_failed") :
        r.status === "axiom_violation" ? fail("axiom_violation") : fail(r.status);

      const row = [
        r.id.padEnd(idW),
        r.name.slice(0, 32).padEnd(nameW),
        r.tag.padEnd(7),
        statusStr.padEnd(20 + (statusStr.length - r.status.length)),
        String(r.tokens || "—").padStart(7),
        (r.usd > 0 ? `$${r.usd.toFixed(4)}` : "—").padStart(9),
        `${r.ms}ms`.padStart(9),
      ].join("  ");
      console.log(`  ${row}`);
    }
  }

  if (errorMessage) {
    console.log(`\n  ${fail("Error:")}\n  ${dim(errorMessage)}`);
  }

  console.log();
  process.exit(runStatus === "completed" && objectiveMet ? 0 : 1);
}

main().catch((e) => {
  console.error(fail("Unexpected error:"), e);
  process.exit(1);
});
