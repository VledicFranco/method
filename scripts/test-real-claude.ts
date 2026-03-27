/**
 * test-real-claude — End-to-end validation of ClaudeHeadlessProvider.
 *
 * Defines a minimal 2-step method (1 agent + 1 script) and runs it
 * against real Claude to validate the full execution pipeline:
 *
 *   Method definition
 *     → ClaudeHeadlessProvider
 *       → spawnClaude (child_process)
 *         → parseClaudeOutput
 *           → postcondition check
 *             → DAG traversal
 *               → objective evaluation
 *
 * Usage:
 *   npx tsx scripts/test-real-claude.ts
 *   npx tsx scripts/test-real-claude.ts --question "What is 2 + 2?"
 *   npx tsx scripts/test-real-claude.ts --model opus
 */

import { parseArgs } from "node:util";
import { Effect } from "effect";

import { Prompt } from "../packages/methodts/src/prompt/prompt.js";
import { check } from "../packages/methodts/src/predicate/predicate.js";
import { ClaudeHeadlessProvider } from "../packages/methodts/src/provider/claude-headless.js";
import { runMethod } from "../packages/methodts/src/runtime/run-method.js";
import { worldState } from "../packages/methodts/src/testkit/builders/state.js";
import { validateAxioms } from "../packages/methodts/src/domain/domain-theory.js";
import { evaluate } from "../packages/methodts/src/predicate/evaluate.js";
import { AgentProvider } from "../packages/methodts/src/provider/agent-provider.js";
import type { Method, Step, WorldState } from "../packages/methodts/src/index.js";
import type { RunMethodError } from "../packages/methodts/src/index.js";

// ── ANSI ──────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const ok   = (s: string) => `${c.green}${s}${c.reset}`;
const fail = (s: string) => `${c.red}${s}${c.reset}`;
const dim  = (s: string) => `${c.dim}${s}${c.reset}`;
const bold = (s: string) => `${c.bold}${s}${c.reset}`;
const cyan = (s: string) => `${c.cyan}${s}${c.reset}`;

// ── Args ──────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    question: { type: "string", default: "What is the capital of France? Answer in one sentence." },
    model:    { type: "string", default: "haiku" },
    budget:   { type: "string", default: "0.10" },
  },
  allowPositionals: false,
});

const question = args.question as string;
const model    = args.model as string;
const budget   = parseFloat(args.budget as string);

// ── State type ────────────────────────────────────────────────────────────────

type QaState = {
  readonly question: string;
  readonly answer: string;
  readonly verified: boolean;
};

// ── Minimal method with one real agent step ───────────────────────────────────

const M_QA: Method<QaState> = {
  id: "M-QA",
  name: "Q&A Validation Method",
  domain: {
    id: "D_QA",
    signature: {
      sorts: [
        { name: "Question", description: "Input question", cardinality: "singleton" },
        { name: "Answer",   description: "Agent response", cardinality: "singleton" },
      ],
      functionSymbols: [],
      predicates: {
        has_question: check<QaState>("has_question", (s) => s.question.length > 0),
        has_answer:   check<QaState>("has_answer",   (s) => s.answer.length > 0),
        verified:     check<QaState>("verified",     (s) => s.verified),
      },
    },
    axioms: {
      question_non_empty: check<QaState>("question_non_empty", (s) => s.question.length > 0),
    },
  },
  roles: [
    {
      id: "analyst",
      description: "Single role: asks and verifies.",
      observe: (s) => s,
      authorized: ["sigma_0", "sigma_1"],
      notAuthorized: [],
    },
  ],
  dag: {
    steps: [
      {
        id: "sigma_0",
        name: "Ask Claude",
        role: "analyst",
        precondition: check("has_question", (s: QaState) => s.question.length > 0),
        postcondition: check("has_answer",  (s: QaState) => s.answer.length > 0),
        execution: {
          tag: "agent",
          role: "analyst",
          context: {},
          prompt: new Prompt<{ state: QaState; world: Record<string, string>; insights: Record<string, string>; domainFacts: string }>(
            (ctx) => ctx.state.question,
          ),
          parse: (raw, current) => {
            const trimmed = raw.trim();
            if (trimmed.length === 0) {
              return Effect.fail({ _tag: "ParseError" as const, message: "Claude returned empty response" });
            }
            return Effect.succeed({ ...current, answer: trimmed });
          },
        },
      },
      {
        id: "sigma_1",
        name: "Verify answer",
        role: "analyst",
        precondition: check("has_answer", (s: QaState) => s.answer.length > 0),
        postcondition: check("verified",  (s: QaState) => s.verified),
        execution: {
          tag: "script",
          execute: (s) => Effect.succeed({ ...s, verified: s.answer.length > 0 }),
        },
      },
    ],
    edges: [{ from: "sigma_0", to: "sigma_1" }],
    initial: "sigma_0",
    terminal: "sigma_1",
  },
  objective: check("complete", (s: QaState) => s.verified && s.answer.length > 0),
  measures: [
    {
      id: "mu_answered",
      name: "Answered",
      compute: (s: QaState) => (s.verified ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};

// ── Logging executor (mirrors run-method.ts pattern) ─────────────────────────

type StepLog = { id: string; status: string; tokens: number; usd: number; ms: number; response?: string };
const stepLogs: StepLog[] = [];

function buildExecutor(m: Method<QaState>) {
  return (step: Step<QaState>, stepState: WorldState<QaState>): Effect.Effect<WorldState<QaState>, RunMethodError, AgentProvider> => {
    return Effect.gen(function* () {
      process.stdout.write(`  ${dim("▶")} [${step.id}] ${step.name}...`);
      const start = Date.now();

      if (step.execution.tag === "script") {
        const newValue = yield* (step.execution.execute(stepState.value) as unknown as Effect.Effect<QaState, { message?: string }, never>).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id,
            message: e.message ?? "Script failed",
          })),
        );
        const axiomResult = validateAxioms(m.domain, newValue);
        if (!axiomResult.valid) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} axiom violation (${ms}ms)\n`);
          stepLogs.push({ id: step.id, status: "axiom_violation", tokens: 0, usd: 0, ms });
          return yield* Effect.fail<RunMethodError>({ _tag: "RunMethodError", methodId: m.id, stepId: step.id, message: `Axiom: ${axiomResult.violations.join(", ")}` });
        }
        if (!evaluate(step.postcondition, newValue)) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} postcondition failed (${ms}ms)\n`);
          stepLogs.push({ id: step.id, status: "postcondition_failed", tokens: 0, usd: 0, ms });
          return yield* Effect.fail<RunMethodError>({ _tag: "RunMethodError", methodId: m.id, stepId: step.id, message: `Postcondition failed: ${step.id}` });
        }
        const ms = Date.now() - start;
        process.stdout.write(` ${ok("✓")} ${dim(`(${ms}ms)`)}\n`);
        stepLogs.push({ id: step.id, status: "completed", tokens: 0, usd: 0, ms });
        return { value: newValue, axiomStatus: axiomResult };

      } else {
        const provider = yield* AgentProvider;
        const ctx = { state: stepState.value, world: {} as Record<string, string>, insights: {} as Record<string, string>, domainFacts: "" };
        const promptText = step.execution.prompt.run(ctx as never);

        const agentResult = yield* provider.execute({ prompt: promptText }).pipe(
          Effect.mapError((e): RunMethodError => ({
            _tag: "RunMethodError", methodId: m.id, stepId: step.id, message: `Agent error: ${e._tag}`,
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
          process.stdout.write(` ${fail("✗")} axiom violation (${ms}ms)\n`);
          stepLogs.push({ id: step.id, status: "axiom_violation", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, response: agentResult.raw });
          return yield* Effect.fail<RunMethodError>({ _tag: "RunMethodError", methodId: m.id, stepId: step.id, message: `Axiom: ${axiomResult.violations.join(", ")}` });
        }
        if (!evaluate(step.postcondition, newValue)) {
          const ms = Date.now() - start;
          process.stdout.write(` ${fail("✗")} postcondition failed (${ms}ms)\n`);
          stepLogs.push({ id: step.id, status: "postcondition_failed", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, response: agentResult.raw });
          return yield* Effect.fail<RunMethodError>({ _tag: "RunMethodError", methodId: m.id, stepId: step.id, message: `Postcondition failed: ${step.id}` });
        }

        const ms = Date.now() - start;
        process.stdout.write(` ${ok("✓")} ${dim(`${agentResult.cost.tokens}tok $${agentResult.cost.usd.toFixed(4)} (${ms}ms)`)}\n`);
        stepLogs.push({ id: step.id, status: "completed", tokens: agentResult.cost.tokens, usd: agentResult.cost.usd, ms, response: agentResult.raw });
        return { value: newValue, axiomStatus: axiomResult };
      }
    });
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`
${bold("═══════════════════════════════════════════════════════════")}
  ${bold("pv-method")} ${dim("/")} test-real-claude
  Method:   ${cyan("M-QA")} — Q&A Validation Method (1 agent + 1 script step)
  Model:    ${cyan(model)}
  Budget:   $${budget.toFixed(2)}
  Question: ${dim(`"${question}"`)}
${bold("═══════════════════════════════════════════════════════════")}
`);

  const initial = worldState<QaState>({ question, answer: "", verified: false });
  const provider = ClaudeHeadlessProvider({ model, maxBudgetUsd: budget, workdir: process.cwd() });

  console.log(`  ${bold("Execution")}\n`);

  const startTime = Date.now();
  let finalState: QaState | undefined;
  let objectiveMet = false;
  let errorMessage: string | undefined;

  try {
    const executor = buildExecutor(M_QA);
    const result = await Effect.runPromise(
      runMethod(M_QA, initial, executor).pipe(Effect.provide(provider)),
    );
    finalState = result.finalState.value;
    objectiveMet = result.objectiveMet;
  } catch (e) {
    errorMessage = (e as Error).message ?? String(e);
  }

  const totalMs = Date.now() - startTime;
  const totalTokens = stepLogs.reduce((s, r) => s + r.tokens, 0);
  const totalUsd = stepLogs.reduce((s, r) => s + r.usd, 0);

  // ── Claude's response ────────────────────────────────────────────────────────

  const agentLog = stepLogs.find((r) => r.response !== undefined);
  if (agentLog?.response) {
    console.log(`\n  ${bold("Claude's response")}\n`);
    for (const line of agentLog.response.split("\n")) {
      console.log(`  ${dim("│")} ${line}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log(`\n  ${bold("Summary")}\n`);

  const checks: [string, boolean, string][] = [
    ["Claude spawned",       stepLogs.length > 0,                          "ClaudeHeadlessProvider → spawnClaude"],
    ["Agent step completed", stepLogs.some((r) => r.status === "completed" && r.tokens > 0), "agentResult parsed, cost captured"],
    ["Parse succeeded",      finalState !== undefined && finalState.answer.length > 0,        "parse() returned non-empty answer"],
    ["Postcondition passed", stepLogs.every((r) => r.status === "completed"),                  "all postconditions satisfied"],
    ["Objective met",        objectiveMet,                                  "s.verified && s.answer.length > 0"],
  ];

  for (const [label, passed, detail] of checks) {
    const badge = passed ? ok("✓") : fail("✗");
    console.log(`  ${badge}  ${label.padEnd(26)} ${dim(detail)}`);
  }

  console.log();
  console.log(`  Tokens:   ${totalTokens > 0 ? String(totalTokens) : dim("0")}`);
  console.log(`  Cost:     ${totalUsd > 0 ? `$${totalUsd.toFixed(5)}` : dim("$0.00")}`);
  console.log(`  Duration: ${(totalMs / 1000).toFixed(1)}s`);

  if (errorMessage) {
    console.log(`\n  ${fail("Error:")} ${dim(errorMessage)}`);
  }

  console.log();

  const allPassed = checks.every(([, p]) => p);
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error(fail("Unexpected error:"), e);
  process.exit(1);
});
