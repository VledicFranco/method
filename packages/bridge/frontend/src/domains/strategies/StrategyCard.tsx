/**
 * PRD 019.3: Strategy definition card with mini-DAG thumbnail.
 *
 * Shows strategy name, ID, node/gate/trigger badges, mini-DAG,
 * last execution summary with gate pass/fail counts.
 * Interactive — click opens detail panel.
 *
 * Card states:
 * - Default: --abyss background, --border border
 * - Hover: lift 2px, border brightens, subtle shadow
 * - Selected: --bio border with 1px outer glow
 * - Running: pulse-glow animation (2.5s ease-in-out)
 */

import { cn } from '@/shared/lib/cn';
import type { StrategyDefinition } from '@/domains/strategies/types';
import { Badge } from '@/shared/components/Badge';
import { StatusBadge, type Status } from '@/shared/data/StatusBadge';
import { formatRelativeTime, formatCost, formatDuration } from '@/shared/lib/formatters';
import { MiniDag } from './MiniDag';

// ── Trigger badge color mapping ──

function triggerBadgeVariant(type: string): 'default' | 'bio' | 'cyan' | 'solar' | 'error' | 'nebular' | 'muted' {
  switch (type) {
    case 'manual': return 'muted';
    case 'git_commit': return 'nebular';
    case 'file_watch': return 'solar';
    case 'schedule': return 'cyan';
    case 'webhook': return 'bio';
    case 'pty_watcher': return 'bio';
    case 'channel_event': return 'nebular';
    default: return 'default';
  }
}

// ── Gate summary text ──

function gateSummary(passed: number, failed: number): string {
  const total = passed + failed;
  if (total === 0) return '';
  if (failed === 0) return `all ${total} gates passed`;
  return `${passed}/${total} gates passed`;
}

export interface StrategyCardProps {
  definition: StrategyDefinition;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function StrategyCard({
  definition,
  selected = false,
  onClick,
  className,
}: StrategyCardProps) {
  const { id, name, nodes, strategy_gates, triggers, last_execution } = definition;
  const isRunning = last_execution?.status === 'running' || last_execution?.status === 'started';

  // Count node types
  const methodologyCount = nodes.filter((n) => n.type === 'methodology').length;
  const scriptCount = nodes.filter((n) => n.type === 'script').length;

  return (
    <div
      className={cn(
        'rounded-card border bg-abyss p-sp-4 transition-all duration-200 cursor-pointer',
        'hover:border-bdr-hover hover:bg-abyss-light hover:-translate-y-0.5 hover:shadow-lg',
        selected
          ? 'border-bio/30 shadow-[0_0_8px_0_var(--bio-glow)]'
          : 'border-bdr',
        isRunning && 'animate-pulse-glow',
        className,
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) onClick();
      }}
    >
      {/* Header: ID + Name */}
      <div className="mb-sp-3">
        <p className="font-mono text-xs text-bio mb-0.5">{id}</p>
        <h3 className="font-display font-bold text-sm text-txt leading-tight truncate">
          {name}
        </h3>
      </div>

      {/* Mini-DAG + Badges row */}
      <div className="flex items-start gap-sp-3 mb-sp-3">
        <MiniDag
          nodes={nodes}
          gates={strategy_gates}
          lastStatus={last_execution?.status}
        />
        <div className="flex-1 min-w-0">
          {/* Node type badges */}
          <div className="flex flex-wrap gap-1 mb-1.5">
            {methodologyCount > 0 && (
              <Badge variant="nebular" label={`${methodologyCount} methodology`} />
            )}
            {scriptCount > 0 && (
              <Badge variant="bio" label={`${scriptCount} script`} />
            )}
          </div>

          {/* Gate badges */}
          {strategy_gates.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {strategy_gates.map((g) => (
                <Badge key={g.id} variant="cyan" label={g.id} />
              ))}
            </div>
          )}

          {/* Trigger badges */}
          <div className="flex flex-wrap gap-1">
            {triggers.map((t, i) => (
              <Badge
                key={`${t.type}-${i}`}
                variant={triggerBadgeVariant(t.type)}
                label={t.type}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Last execution summary */}
      {last_execution ? (
        <div className="pt-sp-2 border-t border-bdr">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={last_execution.status as Status} />
            <span className="text-xs text-txt-muted font-mono">
              {last_execution.completed_at
                ? formatRelativeTime(last_execution.completed_at)
                : last_execution.started_at
                  ? formatRelativeTime(last_execution.started_at)
                  : ''}
            </span>
            {last_execution.cost_usd > 0 && (
              <span className="text-xs text-txt-dim font-mono">
                {formatCost(last_execution.cost_usd)}
              </span>
            )}
            {last_execution.duration_ms > 0 && (
              <span className="text-xs text-txt-dim font-mono">
                {formatDuration(last_execution.duration_ms)}
              </span>
            )}
          </div>
          {/* Gate summary */}
          {(last_execution.gates_passed > 0 || last_execution.gates_failed > 0) && (
            <p className={cn(
              'text-[0.65rem] font-mono mt-1',
              last_execution.gates_failed > 0 ? 'text-solar' : 'text-cyan',
            )}>
              {gateSummary(last_execution.gates_passed, last_execution.gates_failed)}
            </p>
          )}
        </div>
      ) : (
        <div className="pt-sp-2 border-t border-bdr">
          <span className="text-xs text-txt-muted">Never executed</span>
        </div>
      )}
    </div>
  );
}
