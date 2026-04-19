// SPDX-License-Identifier: Apache-2.0
/**
 * Commission — Rendered agent deployment artifacts.
 *
 * A Commission bundles a rendered prompt string with bridge spawn parameters
 * and governance metadata. This is the typed form of the commission concept
 * from P1-EXEC M2-ORCH: given a Prompt<A> and a context A, produce the
 * concrete artifact that the bridge needs to spawn a sub-agent.
 *
 * Pure TypeScript — no Effect dependency.
 *
 * @see PRD 021 Component 9
 */

import type { Prompt } from "../prompt/prompt.js";

/** Bridge spawn parameters — maps to bridge_spawn MCP tool input. */
export type BridgeParams = {
  readonly workdir: string;
  readonly nickname?: string;
  readonly purpose?: string;
  readonly parentSessionId?: string;
  readonly depth?: number;
  readonly budget?: { maxDepth: number; maxAgents: number };
  readonly isolation?: "worktree" | "shared";
  readonly timeoutMs?: number;
  readonly mode?: "pty" | "print";
  readonly spawnArgs?: string[];
  /** PRD 014: Glob patterns of files this agent is allowed to modify. Empty = no constraint. */
  readonly allowedPaths?: readonly string[];
  /** PRD 014: Scope enforcement mode. 'enforce' installs a pre-commit hook (requires worktree). 'warn' emits events only. Default: 'enforce'. */
  readonly scopeMode?: "enforce" | "warn";
};

/** Commission metadata — governance traceability. */
export type CommissionMetadata = {
  readonly generatedAt: Date;
  readonly methodologyId?: string;
  readonly methodId?: string;
  readonly stepId?: string;
};

/** A rendered commission artifact. */
export type Commission<A> = {
  readonly prompt: string;
  readonly context: A;
  readonly bridge: BridgeParams;
  readonly metadata: CommissionMetadata;
};

/**
 * Render a single commission from a prompt template, context, and bridge parameters.
 *
 * Evaluates the prompt template against the context to produce a concrete prompt string,
 * then packages it with bridge params and metadata for deployment.
 *
 * @param promptTemplate - The composable prompt to render
 * @param context - The context value to feed the prompt
 * @param bridge - Bridge spawn parameters for the sub-agent
 * @param metadata - Optional partial metadata (generatedAt defaults to now)
 * @returns A fully rendered Commission artifact
 */
export function commission<A>(
  promptTemplate: Prompt<A>,
  context: A,
  bridge: BridgeParams,
  metadata?: Partial<CommissionMetadata>,
): Commission<A> {
  return {
    prompt: promptTemplate.run(context),
    context,
    bridge,
    metadata: {
      generatedAt: metadata?.generatedAt ?? new Date(),
      methodologyId: metadata?.methodologyId,
      methodId: metadata?.methodId,
      stepId: metadata?.stepId,
    },
  };
}

/**
 * Render a batch of commissions for bridge_spawn_batch.
 *
 * Given a single prompt template and an array of contexts, produces one Commission
 * per context. The bridgeFactory function allows each commission to have unique
 * bridge parameters (e.g., different workdirs, nicknames).
 *
 * @param promptTemplate - The composable prompt to render for each context
 * @param contexts - Array of context values, one per commission
 * @param bridgeFactory - Function that produces BridgeParams for each context and index
 * @param metadata - Optional partial metadata shared across all commissions
 * @returns Array of rendered Commission artifacts
 */
export function batchCommission<A>(
  promptTemplate: Prompt<A>,
  contexts: A[],
  bridgeFactory: (context: A, index: number) => BridgeParams,
  metadata?: Partial<CommissionMetadata>,
): Commission<A>[] {
  return contexts.map((ctx, i) =>
    commission(promptTemplate, ctx, bridgeFactory(ctx, i), metadata),
  );
}
