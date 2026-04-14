/**
 * Pacta-Strategy Integration (Spike)
 *
 * Provides a utility to define Pact-based agent constraints for strategy
 * pipeline steps. A strategy node can declare a PactStrategyConfig that
 * specifies budget, scope, and reasoning constraints for the agent that
 * executes that step.
 *
 * This is ADDITIVE — the existing strategy executor is not modified.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @method/bridge/domains/strategies/.
 */

import type {
  Pact,
  BudgetContract,
  ScopeContract,
  ReasoningPolicy,
} from '@method/pacta';

// ── Strategy Step Pact Configuration ────────────────────────────

/**
 * Pact configuration for a single strategy pipeline step.
 *
 * This is the bridge between strategy YAML node declarations and
 * Pacta's typed contracts. A strategy author declares constraints
 * in the strategy file; this configuration maps them to a Pact.
 */
export interface PactStrategyConfig {
  /** Human-readable label for the step */
  label: string;

  /** Budget constraints for this step's agent */
  budget?: {
    /** Maximum cost in USD */
    maxCostUsd?: number;
    /** Maximum wall-clock time in ms */
    maxDurationMs?: number;
    /** Maximum agent turns */
    maxTurns?: number;
    /** Maximum tokens */
    maxTokens?: number;
    /** What happens when budget is exhausted */
    onExhaustion?: 'stop' | 'warn' | 'error';
  };

  /** Scope constraints for this step's agent */
  scope?: {
    /** Allowed tools */
    allowedTools?: string[];
    /** Denied tools */
    deniedTools?: string[];
    /** Allowed filesystem paths */
    allowedPaths?: string[];
    /** Model to use */
    model?: string;
    /** Permission handling */
    permissionMode?: 'ask' | 'auto' | 'deny';
  };

  /** Reasoning configuration for this step's agent */
  reasoning?: {
    /** Effort level */
    effort?: 'low' | 'medium' | 'high';
    /** Enable think tool */
    thinkTool?: boolean;
    /** Enable planning between actions */
    planBetweenActions?: boolean;
    /** Enable self-reflection on failure */
    reflectOnFailure?: boolean;
  };
}

// ── Pact Builder ────────────────────────────────────────────────

/**
 * Build a Pacta Pact from a strategy step configuration.
 *
 * Converts the strategy-level config into a Pact contract that can
 * be passed to createAgent(). Defaults to oneshot mode (strategy
 * steps are fire-and-forget by nature).
 */
export function buildPactFromStrategyConfig(config: PactStrategyConfig): Pact {
  const budget: BudgetContract | undefined = config.budget
    ? {
        maxCostUsd: config.budget.maxCostUsd,
        maxDurationMs: config.budget.maxDurationMs,
        maxTurns: config.budget.maxTurns,
        maxTokens: config.budget.maxTokens,
        onExhaustion: config.budget.onExhaustion,
      }
    : undefined;

  const scope: ScopeContract | undefined = config.scope
    ? {
        allowedTools: config.scope.allowedTools,
        deniedTools: config.scope.deniedTools,
        allowedPaths: config.scope.allowedPaths,
        model: config.scope.model,
        permissionMode: config.scope.permissionMode,
      }
    : undefined;

  const reasoning: ReasoningPolicy | undefined = config.reasoning
    ? {
        effort: config.reasoning.effort,
        thinkTool: config.reasoning.thinkTool,
        planBetweenActions: config.reasoning.planBetweenActions,
        reflectOnFailure: config.reasoning.reflectOnFailure,
      }
    : undefined;

  return {
    mode: { type: 'oneshot' },
    budget,
    scope,
    reasoning,
  };
}

// ── Strategy Pipeline Pact Collection ───────────────────────────

/**
 * A collection of PactStrategyConfigs for an entire strategy pipeline.
 *
 * Maps step labels to their Pact configurations. The strategy executor
 * can look up constraints for each node before spawning an agent.
 */
export interface PactStrategyPipeline {
  /** Strategy name */
  name: string;

  /** Default constraints applied to all steps (overridden by step-specific) */
  defaults?: Omit<PactStrategyConfig, 'label'>;

  /** Per-step configurations keyed by step label */
  steps: Record<string, PactStrategyConfig>;
}

/**
 * Resolve the Pact for a specific strategy step.
 *
 * Merges pipeline defaults with step-specific overrides. Step-level
 * values take precedence over pipeline defaults.
 */
export function resolveStepPact(
  pipeline: PactStrategyPipeline,
  stepLabel: string,
): Pact {
  const stepConfig = pipeline.steps[stepLabel];
  if (!stepConfig) {
    // No step-specific config — use defaults or empty pact
    if (pipeline.defaults) {
      return buildPactFromStrategyConfig({
        label: stepLabel,
        ...pipeline.defaults,
      });
    }
    return { mode: { type: 'oneshot' } };
  }

  // Merge defaults with step-specific config (step wins)
  const merged: PactStrategyConfig = {
    label: stepConfig.label,
    budget: {
      ...pipeline.defaults?.budget,
      ...stepConfig.budget,
    },
    scope: {
      ...pipeline.defaults?.scope,
      ...stepConfig.scope,
    },
    reasoning: {
      ...pipeline.defaults?.reasoning,
      ...stepConfig.reasoning,
    },
  };

  return buildPactFromStrategyConfig(merged);
}

/**
 * Validate a PactStrategyPipeline for basic constraint consistency.
 *
 * Returns a list of warnings (non-blocking) for suspicious configurations.
 */
export function validatePactPipeline(
  pipeline: PactStrategyPipeline,
): string[] {
  const warnings: string[] = [];

  for (const [label, config] of Object.entries(pipeline.steps)) {
    // Warn if budget is very low (likely a misconfiguration)
    if (config.budget?.maxCostUsd !== undefined && config.budget.maxCostUsd <= 0) {
      warnings.push(`Step "${label}": maxCostUsd <= 0 — agent will be immediately budget-exhausted`);
    }
    if (config.budget?.maxTurns !== undefined && config.budget.maxTurns <= 0) {
      warnings.push(`Step "${label}": maxTurns <= 0 — agent cannot execute any actions`);
    }
    if (config.budget?.maxDurationMs !== undefined && config.budget.maxDurationMs <= 0) {
      warnings.push(`Step "${label}": maxDurationMs <= 0 — agent will immediately timeout`);
    }

    // Warn if scope allows nothing
    if (config.scope?.allowedTools && config.scope.allowedTools.length === 0) {
      warnings.push(`Step "${label}": empty allowedTools — agent has no tools available`);
    }
  }

  return warnings;
}
