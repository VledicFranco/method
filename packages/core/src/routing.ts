import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { RoutingPredicate, RoutingArm, RoutingInfo } from './types.js';

function readYaml(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Failed to parse ${filePath}: YAML did not produce an object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Extract method ID from a `returns` field value.
 * "Some(M7-PRDS)" -> "M7-PRDS"
 * "None" -> null
 */
function parseReturns(returns: string): string | null {
  if (returns === 'None') return null;
  const match = returns.match(/^Some\((.+)\)$/);
  return match ? match[1] : null;
}

export function getMethodologyRouting(registryPath: string, methodologyId: string): RoutingInfo {
  const filePath = join(registryPath, methodologyId, `${methodologyId}.yaml`);

  if (!existsSync(filePath)) {
    throw new Error(`Methodology ${methodologyId} not found in registry`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = readYaml(filePath);
  } catch (e) {
    if ((e as Error).message.startsWith('Failed to parse')) {
      throw e;
    }
    throw new Error(`Failed to parse ${filePath}: ${(e as Error).message}`);
  }

  // Verify this is a methodology, not a method
  if (parsed['method'] && !parsed['methodology']) {
    throw new Error(
      `YAML at ${filePath} is a method, not a methodology. Routing is only available for methodology-level files.`
    );
  }

  const methodologyBlock = parsed['methodology'] as Record<string, unknown> | undefined;
  if (!methodologyBlock) {
    throw new Error(`Methodology ${methodologyId} not found in registry`);
  }

  const transitionFunction = parsed['transition_function'] as Record<string, unknown> | undefined;
  if (!transitionFunction) {
    throw new Error(`Methodology ${methodologyId} has no transition_function defined`);
  }

  // Extract methodology metadata
  const methodologyIdFromYaml = (methodologyBlock['id'] as string) ?? methodologyId;
  const methodologyName = (methodologyBlock['name'] as string) ?? methodologyId;

  // Extract formal predicates from domain_theory
  const domainTheory = parsed['domain_theory'] as Record<string, unknown> | undefined;
  const formalPredicates = (domainTheory?.['predicates'] as Array<Record<string, unknown>>) ?? [];

  // Extract operationalization predicates
  const predOp = parsed['predicate_operationalization'] as Record<string, unknown> | undefined;
  const opPredicates = (predOp?.['predicates'] as Array<Record<string, unknown>>) ?? [];
  const evaluationOrder = (predOp?.['evaluation_order'] as string) ?? '';

  // Build operationalization lookup by name
  const opMap = new Map<string, { trueWhen: string | null; falseWhen: string | null }>();
  for (const op of opPredicates) {
    const name = op['name'] as string;
    const trueWhen = typeof op['true_when'] === 'string' ? op['true_when'].trim() : null;
    const falseWhen = typeof op['false_when'] === 'string' ? op['false_when'].trim() : null;
    opMap.set(name, { trueWhen, falseWhen });
  }

  // Merge predicates: formal predicates are the authoritative set
  const predicates: RoutingPredicate[] = formalPredicates.map((fp) => {
    const name = fp['name'] as string;
    const description = typeof fp['description'] === 'string' ? fp['description'].trim() : null;
    const op = opMap.get(name);
    return {
      name,
      description,
      trueWhen: op?.trueWhen ?? null,
      falseWhen: op?.falseWhen ?? null,
    };
  });

  // Extract arms from transition_function
  const rawArms = (transitionFunction['arms'] as Array<Record<string, unknown>>) ?? [];
  const arms: RoutingArm[] = rawArms.map((arm) => ({
    priority: arm['priority'] as number,
    label: arm['label'] as string,
    condition: arm['condition'] as string,
    selects: parseReturns(arm['returns'] as string),
    rationale: typeof arm['rationale'] === 'string' ? arm['rationale'].trim() : null,
  }));

  return {
    methodologyId: methodologyIdFromYaml,
    name: methodologyName,
    predicates,
    arms,
    evaluationOrder: evaluationOrder.trim(),
  };
}
