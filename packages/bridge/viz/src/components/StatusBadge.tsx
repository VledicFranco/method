import type { NodeStatus } from '../lib/types';

interface StatusBadgeProps {
  status: NodeStatus | 'passed' | 'failed' | string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  gate_failed: 'Gate Failed',
  suspended: 'Suspended',
  passed: 'Passed',
  started: 'Started',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '\u25CB',     // open circle
  running: '',           // spinner handled by CSS
  completed: '\u2713',   // check mark
  failed: '\u2717',      // ballot x
  gate_failed: '\u26A0', // warning
  suspended: '\u23F8',   // pause
  passed: '\u2713',      // check mark
  started: '',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const cssClass = `status-badge status-badge--${status}`;
  const label = STATUS_LABELS[status] ?? status;
  const icon = STATUS_ICONS[status] ?? '';

  return (
    <span className={cssClass}>
      {status === 'running' ? (
        <span className="spinner" />
      ) : icon ? (
        <span>{icon}</span>
      ) : null}
      {label}
    </span>
  );
}
