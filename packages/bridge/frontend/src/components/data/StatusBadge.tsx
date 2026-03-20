import { cn } from '@/lib/cn';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  PauseCircle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

export type Status = 'running' | 'completed' | 'failed' | 'pending' | 'suspended' | 'warning' | 'dead' | 'queued';

interface StatusConfig {
  icon: LucideIcon;
  bg: string;
  text: string;
  label: string;
  animate?: string;
}

const STATUS_CONFIG: Record<Status, StatusConfig> = {
  running: {
    icon: Loader2,
    bg: 'bg-bio-dim',
    text: 'text-bio',
    label: 'Running',
    animate: 'animate-spin',
  },
  completed: {
    icon: CheckCircle2,
    bg: 'bg-cyan/15',
    text: 'text-cyan',
    label: 'Completed',
  },
  failed: {
    icon: XCircle,
    bg: 'bg-error-dim',
    text: 'text-error',
    label: 'Failed',
  },
  pending: {
    icon: Circle,
    bg: 'bg-txt-muted/10',
    text: 'text-txt-dim',
    label: 'Pending',
  },
  queued: {
    icon: Circle,
    bg: 'bg-txt-muted/10',
    text: 'text-txt-dim',
    label: 'Queued',
  },
  suspended: {
    icon: PauseCircle,
    bg: 'bg-nebular-dim',
    text: 'text-nebular',
    label: 'Suspended',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-solar-dim',
    text: 'text-solar',
    label: 'Warning',
  },
  dead: {
    icon: XCircle,
    bg: 'bg-txt-muted/5',
    text: 'text-txt-muted',
    label: 'Dead',
  },
};

export interface StatusBadgeProps {
  status: Status;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-body font-medium',
        config.bg,
        config.text,
        size === 'sm' ? 'px-2 py-0.5 text-[0.7rem]' : 'px-3 py-1 text-[0.8rem]',
        className,
      )}
    >
      <Icon className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5', config.animate)} />
      {config.label}
    </span>
  );
}
