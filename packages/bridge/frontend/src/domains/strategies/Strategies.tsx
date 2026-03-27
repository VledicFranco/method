/**
 * Pipelines — unified view combining Strategies + Triggers into a single
 * table-based page (Proposal B).
 *
 * Data sources:
 *   - useStrategyDefinitions()  — strategy definitions with inline trigger defs
 *   - useStrategyExecutions()   — execution history
 *   - useExecuteStrategy()      — mutation to run a strategy
 *   - useTriggerList()          — live trigger registrations with stats
 *   - usePauseTriggers / useResumeTriggers / useReloadTriggers — bulk actions
 */

import { useState, useMemo, useCallback, type CSSProperties } from 'react';
import { PageShell } from '@/shared/layout/PageShell';
import {
  useStrategyDefinitions,
  useStrategyExecutions,
  useExecuteStrategy,
} from '@/domains/strategies/useStrategies';
import {
  useTriggerList,
  usePauseTriggers,
  useResumeTriggers,
  useReloadTriggers,
} from '@/domains/triggers/useTriggers';
import { formatCost, formatDuration, formatRelativeTime } from '@/shared/lib/formatters';
import type { StrategyDefinition } from '@/domains/strategies/types';
import type { TriggerListItem } from '@/domains/triggers/types';

// ── Color palette ────────────────────────────────────────────────

const C = {
  void: '#0a0e14',
  abyss: '#111923',
  abyssLight: '#1a2433',
  bio: '#00e5a0',
  solar: '#f5a623',
  text: '#e0e8f0',
  textMuted: '#6b7d8e',
  border: 'rgba(255,255,255,0.08)',
  error: '#ff4757',
  cyan: '#00c8ff',
  nebular: '#a78bfa',
} as const;

// ── Trigger-type pill config ─────────────────────────────────────

const PILL_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  manual: { bg: 'rgba(107,125,142,0.2)', fg: C.textMuted, label: 'manual' },
  file_watch: { bg: 'rgba(245,166,35,0.15)', fg: C.solar, label: 'file_watch' },
  git_commit: { bg: 'rgba(167,139,250,0.15)', fg: C.nebular, label: 'git_commit' },
  schedule: { bg: 'rgba(0,229,160,0.15)', fg: C.bio, label: 'schedule' },
  webhook: { bg: 'rgba(0,200,255,0.15)', fg: C.cyan, label: 'webhook' },
  pty_watcher: { bg: 'rgba(255,71,87,0.15)', fg: C.error, label: 'pty_watcher' },
  channel_event: { bg: 'rgba(167,139,250,0.15)', fg: C.nebular, label: 'channel_event' },
};

// ── Filter tabs ──────────────────────────────────────────────────

type FilterKey = 'all' | 'active' | 'file_watch' | 'manual';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'file_watch', label: 'File Watch' },
  { key: 'manual', label: 'Manual' },
];

// ── Helpers ──────────────────────────────────────────────────────

/** Collect unique trigger types from definition-level triggers */
function defTriggerTypes(def: StrategyDefinition): string[] {
  return def.triggers.map((t) => t.type);
}

/** Check whether a strategy has any active registered triggers */
function hasActiveTriggers(
  def: StrategyDefinition,
  triggerMap: Map<string, TriggerListItem[]>,
): boolean {
  const regs = triggerMap.get(def.id);
  return !!regs && regs.some((t) => t.enabled);
}

/** Build a map: strategyId -> TriggerListItem[] */
function buildTriggerMap(triggers: TriggerListItem[]): Map<string, TriggerListItem[]> {
  const m = new Map<string, TriggerListItem[]>();
  for (const t of triggers) {
    if (!m.has(t.strategy_id)) m.set(t.strategy_id, []);
    m.get(t.strategy_id)!.push(t);
  }
  return m;
}

// ── Inline style factories ───────────────────────────────────────

const s = {
  page: {
    minHeight: '100vh',
    background: C.void,
    color: C.text,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: '24px 28px',
  } as CSSProperties,

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 12,
    marginBottom: 20,
  } as CSSProperties,

  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as CSSProperties,

  title: {
    fontSize: 20,
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.02em',
  } as CSSProperties,

  countBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 9999,
    background: 'rgba(0,229,160,0.12)',
    color: C.bio,
  } as CSSProperties,

  btnGroup: {
    display: 'flex',
    gap: 8,
  } as CSSProperties,

  btn: (variant: 'default' | 'primary' | 'danger' = 'default'): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: variant === 'default' ? `1px solid ${C.border}` : 'none',
    background:
      variant === 'primary'
        ? C.bio
        : variant === 'danger'
          ? C.error
          : 'transparent',
    color:
      variant === 'primary'
        ? C.void
        : variant === 'danger'
          ? '#fff'
          : C.text,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }),

  filterBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 16,
    borderBottom: `1px solid ${C.border}`,
    paddingBottom: 8,
  } as CSSProperties,

  filterTab: (active: boolean): CSSProperties => ({
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    borderRadius: 4,
    border: 'none',
    background: active ? 'rgba(0,229,160,0.1)' : 'transparent',
    color: active ? C.bio : C.textMuted,
    cursor: 'pointer',
    transition: 'all 0.15s',
  }),

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  } as CSSProperties,

  th: {
    textAlign: 'left' as const,
    padding: '8px 12px',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: C.textMuted,
    borderBottom: `1px solid ${C.border}`,
  } as CSSProperties,

  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: 'top' as const,
  } as CSSProperties,

  tr: (expanded: boolean): CSSProperties => ({
    cursor: 'pointer',
    background: expanded ? C.abyssLight : 'transparent',
    transition: 'background 0.15s',
  }),

  nameCell: {
    fontWeight: 600,
    fontSize: 13,
    lineHeight: 1.3,
  } as CSSProperties,

  idLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
    wordBreak: 'break-all' as const,
  } as CSSProperties,

  pill: (type: string): CSSProperties => {
    const cfg = PILL_STYLES[type] ?? PILL_STYLES.manual;
    return {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 9999,
      fontSize: 10,
      fontWeight: 500,
      fontFamily: "'JetBrains Mono', monospace",
      background: cfg.bg,
      color: cfg.fg,
      marginRight: 4,
      marginBottom: 2,
    };
  },

  statusDot: (active: boolean): CSSProperties => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: active ? C.bio : C.textMuted,
    boxShadow: active ? `0 0 6px ${C.bio}` : 'none',
    animation: active ? 'pulse-dot 2s ease-in-out infinite' : 'none',
  }),

  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: 'transparent',
    color: C.text,
    cursor: 'pointer',
    fontSize: 14,
    transition: 'all 0.15s',
    marginRight: 4,
  } as CSSProperties,

  expandedRow: {
    background: C.abyss,
    borderBottom: `1px solid ${C.border}`,
  } as CSSProperties,

  expandedInner: {
    padding: '16px 12px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  } as CSSProperties,

  expandedSection: {
    marginBottom: 8,
  } as CSSProperties,

  expandedLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: C.textMuted,
    marginBottom: 6,
  } as CSSProperties,

  dagContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  } as CSSProperties,

  dagDot: (type: 'methodology' | 'script'): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: type === 'methodology' ? C.bio : C.solar,
    flexShrink: 0,
  }),

  dagLine: {
    width: 16,
    height: 2,
    background: C.border,
    flexShrink: 0,
  } as CSSProperties,

  dagNodeLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: C.textMuted,
  } as CSSProperties,

  triggerDetailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    fontSize: 11,
    borderBottom: `1px solid ${C.border}`,
  } as CSSProperties,

  triggerDetailLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    color: C.textMuted,
    fontSize: 10,
  } as CSSProperties,

  triggerDetailValue: {
    fontFamily: "'JetBrains Mono', monospace",
    color: C.text,
    fontSize: 10,
  } as CSSProperties,

  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginTop: 32,
    marginBottom: 12,
    color: C.text,
  } as CSSProperties,

  timelineContainer: {
    position: 'relative' as const,
    paddingLeft: 24,
    borderLeft: `2px solid ${C.border}`,
    marginLeft: 6,
  } as CSSProperties,

  timelineItem: {
    position: 'relative' as const,
    paddingBottom: 16,
  } as CSSProperties,

  timelineDot: (status: string): CSSProperties => ({
    position: 'absolute' as const,
    left: -29,
    top: 4,
    width: 10,
    height: 10,
    borderRadius: '50%',
    background:
      status === 'completed'
        ? C.bio
        : status === 'running' || status === 'started'
          ? C.solar
          : status === 'failed'
            ? C.error
            : C.textMuted,
    border: `2px solid ${C.void}`,
  }),

  timelineContent: {
    fontSize: 12,
    lineHeight: 1.5,
  } as CSSProperties,

  timelineName: {
    fontWeight: 600,
    color: C.text,
  } as CSSProperties,

  timelineMeta: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
  } as CSSProperties,

  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.abyss,
    color: C.textMuted,
    fontSize: 13,
  } as CSSProperties,

  toast: (variant: 'success' | 'error'): CSSProperties => ({
    position: 'fixed' as const,
    bottom: 24,
    right: 24,
    zIndex: 50,
    maxWidth: 360,
    padding: '10px 16px',
    borderRadius: 8,
    border: `1px solid ${variant === 'error' ? 'rgba(255,71,87,0.3)' : 'rgba(0,229,160,0.3)'}`,
    background: variant === 'error' ? 'rgba(255,71,87,0.08)' : C.abyss,
    color: variant === 'error' ? C.error : C.text,
    fontSize: 13,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    animation: 'slide-in 0.3s ease-out',
  }),

  // Responsive helper: hidden on mobile
  hideMobile: {
    // Applied via media query in the style tag
  } as CSSProperties,

  gateChip: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
    background: 'rgba(0,200,255,0.1)',
    color: C.cyan,
    marginRight: 4,
    marginBottom: 2,
  } as CSSProperties,

  nodeBreakdown: {
    display: 'flex',
    gap: 12,
    fontSize: 11,
  } as CSSProperties,

  nodeBreakdownItem: (color: string): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color,
  }),
};

// ── Keyframe injection ───────────────────────────────────────────

const STYLE_TAG_ID = 'pipelines-keyframes';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_TAG_ID;
  style.textContent = `
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes slide-in {
      from { transform: translateX(20px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @media (max-width: 767px) {
      .pipelines-hide-mobile { display: none !important; }
      .pipelines-expanded-grid { grid-template-columns: 1fr !important; }
    }
  `;
  document.head.appendChild(style);
}

// ── Toast state ──────────────────────────────────────────────────

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  visible: boolean;
}

// ── Main component ───────────────────────────────────────────────

export default function Strategies() {
  ensureKeyframes();

  // Data hooks
  const { data: defData, isLoading: defsLoading, refetch: refetchDefs } = useStrategyDefinitions();
  const { data: executions, isLoading: execsLoading } = useStrategyExecutions();
  const executeMutation = useExecuteStrategy();
  const { data: triggerData } = useTriggerList();
  const pauseMutation = usePauseTriggers();
  const resumeMutation = useResumeTriggers();
  const reloadMutation = useReloadTriggers();

  // Local state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [toast, setToast] = useState<ToastState | null>(null);

  // Derived data
  const definitions = useMemo(() => defData?.definitions ?? [], [defData]);
  const triggers = useMemo(() => triggerData?.triggers ?? [], [triggerData]);
  const paused = triggerData?.paused ?? false;
  const triggerMap = useMemo(() => buildTriggerMap(triggers), [triggers]);

  const allExecutions = useMemo(
    () =>
      [...(executions ?? [])].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      ),
    [executions],
  );

  const recentRuns = useMemo(() => allExecutions.slice(0, 10), [allExecutions]);

  // Filtered definitions
  const filtered = useMemo(() => {
    if (filter === 'all') return definitions;
    if (filter === 'active') return definitions.filter((d) => hasActiveTriggers(d, triggerMap));
    // Filter by trigger type
    return definitions.filter((d) => {
      const types = defTriggerTypes(d);
      if (types.some((t) => t === filter)) return true;
      // Also check registered triggers
      const regs = triggerMap.get(d.id) ?? [];
      return regs.some((r) => r.type === filter);
    });
  }, [definitions, filter, triggerMap]);

  const loading = defsLoading || execsLoading;

  // Handlers
  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToast({ message, variant, visible: true });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleRowClick = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleExecute = useCallback(
    (def: StrategyDefinition) => {
      executeMutation.mutate(
        {
          strategy_path: `.method/strategies/${def.file_path}`,
          context_inputs: {},
        },
        {
          onSuccess: (data) => {
            showToast(`Pipeline "${def.name}" started (${data.execution_id})`, 'success');
          },
          onError: (error) => {
            showToast(`Failed to execute: ${(error as Error).message}`, 'error');
          },
        },
      );
    },
    [executeMutation, showToast],
  );

  const handleReload = useCallback(async () => {
    try {
      await reloadMutation.mutateAsync();
      refetchDefs();
      showToast('Triggers reloaded', 'success');
    } catch (e) {
      showToast(`Reload failed: ${(e as Error).message}`, 'error');
    }
  }, [reloadMutation, refetchDefs, showToast]);

  const handlePauseAll = useCallback(async () => {
    try {
      if (paused) {
        await resumeMutation.mutateAsync();
        showToast('All triggers resumed', 'success');
      } else {
        await pauseMutation.mutateAsync();
        showToast('All triggers paused', 'success');
      }
    } catch (e) {
      showToast(`Action failed: ${(e as Error).message}`, 'error');
    }
  }, [paused, pauseMutation, resumeMutation, showToast]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <PageShell breadcrumbs={[{ label: 'Pipelines' }]}>
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.titleRow}>
          <h1 style={s.title}>Pipelines</h1>
          <span style={s.countBadge}>{definitions.length}</span>
        </div>
        <div style={s.btnGroup}>
          <button
            style={s.btn()}
            onClick={handleReload}
            disabled={reloadMutation.isPending}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            {reloadMutation.isPending ? '...' : 'Reload'}
          </button>
          <button
            style={s.btn()}
            onClick={handlePauseAll}
            disabled={pauseMutation.isPending || resumeMutation.isPending}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            {paused ? 'Resume All' : 'Pause All'}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={s.filterBar}>
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            style={s.filterTab(filter === tab.key)}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && definitions.length === 0 && (
        <div style={s.emptyState}>
          <span>Loading pipelines...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && definitions.length === 0 && (
        <div style={s.emptyState}>
          <span>No strategy definitions found in .method/strategies/</span>
          <span style={{ fontSize: 11, marginTop: 4, color: C.textMuted }}>
            Add strategy YAML files and reload.
          </span>
        </div>
      )}

      {/* Pipeline table */}
      {filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th} className="pipelines-hide-mobile">Nodes</th>
                <th style={s.th}>Trigger</th>
                <th style={s.th} className="pipelines-hide-mobile">Status</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((def) => {
                const isExpanded = expandedId === def.id;
                const regs = triggerMap.get(def.id) ?? [];
                const active = hasActiveTriggers(def, triggerMap);
                const triggerTypes = defTriggerTypes(def);
                // Merge registered trigger types that might not be in the definition
                const regTypes = regs.map((r) => r.type as string);
                const allTypes = Array.from(new Set([...triggerTypes, ...regTypes]));
                if (allTypes.length === 0) allTypes.push('manual');

                return (
                  <TableRow
                    key={def.id}
                    def={def}
                    isExpanded={isExpanded}
                    active={active}
                    allTypes={allTypes}
                    regs={regs}
                    onRowClick={handleRowClick}
                    onExecute={handleExecute}
                    executing={executeMutation.isPending}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* No results after filter */}
      {!loading && definitions.length > 0 && filtered.length === 0 && (
        <div style={s.emptyState}>
          <span>No pipelines match the "{filter}" filter</span>
        </div>
      )}

      {/* Recent Runs Timeline */}
      {recentRuns.length > 0 && (
        <div>
          <h2 style={s.sectionTitle}>Recent Runs</h2>
          <div style={s.timelineContainer}>
            {recentRuns.map((exec) => (
              <div key={exec.execution_id} style={s.timelineItem}>
                <div style={s.timelineDot(exec.status)} />
                <div style={s.timelineContent}>
                  <div style={s.timelineName}>
                    {exec.strategy_name}
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 400,
                        color:
                          exec.status === 'completed'
                            ? C.bio
                            : exec.status === 'failed'
                              ? C.error
                              : exec.status === 'running' || exec.status === 'started'
                                ? C.solar
                                : C.textMuted,
                      }}
                    >
                      {exec.status}
                    </span>
                  </div>
                  <div style={s.timelineMeta}>
                    {exec.strategy_id}
                    {exec.cost_usd > 0 && <> &middot; {formatCost(exec.cost_usd)}</>}
                    {' '}&middot; {formatRelativeTime(exec.started_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast?.visible && (
        <div style={s.toast(toast.variant)}>
          {toast.message}
        </div>
      )}
    </div>
    </PageShell>
  );
}

// ── Table row sub-component ──────────────────────────────────────

interface TableRowProps {
  def: StrategyDefinition;
  isExpanded: boolean;
  active: boolean;
  allTypes: string[];
  regs: TriggerListItem[];
  onRowClick: (id: string) => void;
  onExecute: (def: StrategyDefinition) => void;
  executing: boolean;
}

function TableRow({
  def,
  isExpanded,
  active,
  allTypes,
  regs,
  onRowClick,
  onExecute,
  executing,
}: TableRowProps) {
  const methodologyCount = def.nodes.filter((n) => n.type === 'methodology').length;
  const scriptCount = def.nodes.filter((n) => n.type === 'script').length;

  return (
    <>
      {/* Main row */}
      <tr
        style={s.tr(isExpanded)}
        onClick={() => onRowClick(def.id)}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = C.abyssLight;
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* NAME */}
        <td style={s.td}>
          <div style={s.nameCell}>{def.name}</div>
          <div style={s.idLabel}>{def.id}</div>
        </td>

        {/* NODES (hidden on mobile) */}
        <td style={s.td} className="pipelines-hide-mobile">
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            {def.nodes.length}
          </span>
        </td>

        {/* TRIGGER */}
        <td style={s.td}>
          {allTypes.map((type) => (
            <span key={type} style={s.pill(type)}>
              {type}
            </span>
          ))}
        </td>

        {/* STATUS (hidden on mobile) */}
        <td style={s.td} className="pipelines-hide-mobile">
          <span style={s.statusDot(active)} />
        </td>

        {/* ACTIONS */}
        <td style={s.td}>
          <button
            style={s.actionBtn}
            title="Run pipeline"
            disabled={executing}
            onClick={(e) => {
              e.stopPropagation();
              onExecute(def);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,229,160,0.1)';
              (e.currentTarget as HTMLButtonElement).style.color = C.bio;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = C.text;
            }}
          >
            &#x25B6;
          </button>
          <button
            style={s.actionBtn}
            title="Settings"
            onClick={(e) => {
              e.stopPropagation();
              // Toggle expand as settings action
              onRowClick(def.id);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            &#x2699;
          </button>
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr>
          <td colSpan={5} style={s.expandedRow}>
            <div style={s.expandedInner} className="pipelines-expanded-grid">
              {/* Left column: DAG + Node breakdown */}
              <div>
                {/* DAG visualization */}
                <div style={s.expandedSection}>
                  <div style={s.expandedLabel}>DAG</div>
                  <div style={s.dagContainer}>
                    {def.nodes.map((node, idx) => (
                      <span key={node.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {idx > 0 && <span style={s.dagLine} />}
                        <span style={s.dagDot(node.type)} title={node.id} />
                        <span style={s.dagNodeLabel}>{node.id}</span>
                      </span>
                    ))}
                    {def.nodes.length === 0 && (
                      <span style={{ fontSize: 11, color: C.textMuted }}>No nodes</span>
                    )}
                  </div>
                </div>

                {/* Node breakdown */}
                <div style={s.expandedSection}>
                  <div style={s.expandedLabel}>Node Breakdown</div>
                  <div style={s.nodeBreakdown}>
                    <span style={s.nodeBreakdownItem(C.bio)}>
                      <span style={{ ...s.dagDot('methodology'), width: 8, height: 8 }} />
                      {methodologyCount} methodology
                    </span>
                    <span style={s.nodeBreakdownItem(C.solar)}>
                      <span style={{ ...s.dagDot('script'), width: 8, height: 8 }} />
                      {scriptCount} script
                    </span>
                  </div>
                </div>

                {/* Gates */}
                {def.strategy_gates.length > 0 && (
                  <div style={s.expandedSection}>
                    <div style={s.expandedLabel}>Gates</div>
                    <div>
                      {def.strategy_gates.map((gate) => (
                        <span key={gate.id} style={s.gateChip}>
                          {gate.id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: Trigger details */}
              <div>
                <div style={s.expandedLabel}>Trigger Details</div>
                {regs.length > 0 ? (
                  regs.map((reg) => (
                    <TriggerDetailBlock key={reg.trigger_id} trigger={reg} />
                  ))
                ) : def.triggers.length > 0 ? (
                  def.triggers.map((t, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <span style={s.pill(t.type)}>{t.type}</span>
                      {t.config && Object.keys(t.config).length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {Object.entries(t.config).map(([k, v]) => (
                            <div key={k} style={s.triggerDetailRow}>
                              <span style={s.triggerDetailLabel}>{k}</span>
                              <span style={s.triggerDetailValue}>
                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    Manual trigger only
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Trigger detail block for registered triggers ─────────────────

function TriggerDetailBlock({ trigger }: { trigger: TriggerListItem }) {
  const cfg = trigger.trigger_config;
  const stats = trigger.stats;

  return (
    <div style={{ marginBottom: 12, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={s.pill(trigger.type)}>{trigger.type}</span>
        <span style={{
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
          color: trigger.enabled ? C.bio : C.textMuted,
        }}>
          {trigger.enabled ? 'active' : 'disabled'}
        </span>
      </div>

      {/* File watch paths */}
      {(cfg.paths ?? cfg.path_pattern) && (
        <div style={s.triggerDetailRow}>
          <span style={s.triggerDetailLabel}>paths</span>
          <span style={s.triggerDetailValue}>
            {cfg.paths ? cfg.paths.join(', ') : cfg.path_pattern}
          </span>
        </div>
      )}

      {/* Debounce */}
      {cfg.debounce_ms && (
        <div style={s.triggerDetailRow}>
          <span style={s.triggerDetailLabel}>debounce</span>
          <span style={s.triggerDetailValue}>
            {formatDuration(cfg.debounce_ms)}
          </span>
        </div>
      )}

      {/* Schedule */}
      {cfg.cron && (
        <div style={s.triggerDetailRow}>
          <span style={s.triggerDetailLabel}>cron</span>
          <span style={s.triggerDetailValue}>{cfg.cron}</span>
        </div>
      )}

      {/* Git branch */}
      {cfg.branch_pattern && (
        <div style={s.triggerDetailRow}>
          <span style={s.triggerDetailLabel}>branch</span>
          <span style={s.triggerDetailValue}>{cfg.branch_pattern}</span>
        </div>
      )}

      {/* Stats */}
      <div style={s.triggerDetailRow}>
        <span style={s.triggerDetailLabel}>fires</span>
        <span style={s.triggerDetailValue}>{stats.total_fires}</span>
      </div>

      {stats.last_fired_at && (
        <div style={s.triggerDetailRow}>
          <span style={s.triggerDetailLabel}>last fired</span>
          <span style={s.triggerDetailValue}>
            {formatRelativeTime(stats.last_fired_at)}
          </span>
        </div>
      )}

      {stats.debounced_events > 0 && (
        <div style={s.triggerDetailRow}>
          <span style={s.triggerDetailLabel}>debounced</span>
          <span style={s.triggerDetailValue}>{stats.debounced_events} events</span>
        </div>
      )}
    </div>
  );
}
