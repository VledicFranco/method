/**
 * Task Partition Config — capacity and accepted content types.
 *
 * PRD 044 C-2: The task partition holds goals, strategies, progress updates,
 * and milestones. Smallest partition — goals should be few and persistent.
 */

export const TASK_PARTITION_CONFIG = {
  id: 'task' as const,
  capacity: 6,
  acceptedTypes: ['goal', 'strategy', 'progress', 'milestone'] as const,
};
