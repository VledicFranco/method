import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

/**
 * Custom xyflow edge with status-based styling.
 * - pending: dim, thin
 * - active: glowing bio, animated dash
 * - completed: bright, solid
 * - failed: solar, dashed
 */
export function AnimatedEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;

  const edgeData = data as { status?: string } | undefined;
  const status = edgeData?.status ?? 'pending';

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  // Style based on status
  let stroke: string;
  let strokeWidth: number;
  let strokeDasharray: string | undefined;
  let filter: string | undefined;
  let animation: string | undefined;

  switch (status) {
    case 'active':
      stroke = '#00c9a7';
      strokeWidth = 2;
      strokeDasharray = '5 5';
      filter = 'drop-shadow(0 0 4px rgba(0, 201, 167, 0.4))';
      animation = 'edge-flow 1s linear infinite';
      break;
    case 'completed':
      stroke = '#00e5cc';
      strokeWidth = 1.5;
      break;
    case 'failed':
      stroke = '#e8a45a';
      strokeWidth = 1.5;
      strokeDasharray = '5 5';
      break;
    default: // pending
      stroke = 'rgba(26, 107, 90, 0.25)';
      strokeWidth = 1.5;
      break;
  }

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke,
        strokeWidth,
        strokeDasharray,
        filter,
        animation,
      }}
    />
  );
}
