/** Animated edge for the xyflow DAG — status-aware with Narrative Flow colors */

import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

export function AnimatedEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const edgeData = data as { status?: string } | undefined;
  const status = edgeData?.status ?? 'pending';

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 16,
  });

  let stroke: string;
  let strokeWidth: number;
  let strokeDasharray: string | undefined;
  let filter: string | undefined;
  let animation: string | undefined;

  switch (status) {
    case 'active':
      stroke = 'var(--bio)';
      strokeWidth = 2;
      strokeDasharray = '5 5';
      filter = 'drop-shadow(0 0 4px rgba(0, 201, 167, 0.4))';
      animation = 'edge-flow 1s linear infinite';
      break;
    case 'completed':
      stroke = 'var(--cyan)';
      strokeWidth = 1.5;
      break;
    case 'failed':
      stroke = 'var(--error)';
      strokeWidth = 1.5;
      strokeDasharray = '5 5';
      break;
    default:
      stroke = 'var(--border)';
      strokeWidth = 1.5;
      break;
  }

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{ stroke, strokeWidth, strokeDasharray, filter, animation }}
    />
  );
}
