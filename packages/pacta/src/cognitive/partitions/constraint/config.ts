/**
 * Constraint Partition Config — capacity and accepted content types.
 *
 * PRD 044 C-2: The constraint partition holds safety-critical entries
 * (prohibitions, invariants, boundaries, rules). Capacity is deliberately
 * small — constraints should be few and high-value.
 */

export const CONSTRAINT_PARTITION_CONFIG = {
  id: 'constraint' as const,
  capacity: 10,
  acceptedTypes: ['constraint', 'invariant', 'boundary', 'rule'] as const,
};
