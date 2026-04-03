/**
 * Type Resolver — maps EntryContentType[] to PartitionId[] (PRD 045 S-9).
 *
 * Decouples modules from partition identity (RFC 003 Q5). Modules declare
 * what entry types they need; the resolver finds which partitions hold them.
 *
 * The mapping is static — derived from the coarse EntryContentType → PartitionId
 * correspondence. When new partitions are added, the resolver picks up new
 * mappings automatically from partition configs.
 */

import type { EntryContentType } from '../algebra/workspace-types.js';
import type { PartitionId, TypeResolver } from '../algebra/partition-types.js';

/**
 * Coarse mapping from EntryContentType to the partition that owns it.
 *
 * This is the authoritative type→partition registry. The 3-member
 * EntryContentType union (PRD 043 D7) maps 1:1 to partitions:
 *   'constraint'  → constraint partition
 *   'goal'        → task partition
 *   'operational'  → operational partition
 */
const TYPE_TO_PARTITION = new Map<EntryContentType, PartitionId>([
  ['constraint', 'constraint'],
  ['goal', 'task'],
  ['operational', 'operational'],
]);

/**
 * Creates a TypeResolver that maps EntryContentType[] → PartitionId[].
 *
 * The resolver is stateless and pure — safe to create once and reuse.
 */
export function createTypeResolver(): TypeResolver {
  return {
    resolve(types: EntryContentType[]): PartitionId[] {
      const partitions = new Set<PartitionId>();
      for (const t of types) {
        const target = TYPE_TO_PARTITION.get(t);
        if (target) {
          partitions.add(target);
        }
      }
      return [...partitions];
    },
  };
}
