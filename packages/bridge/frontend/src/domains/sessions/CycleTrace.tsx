/**
 * CycleTrace — renders the cognitive cycle timeline inline between
 * the user prompt and agent response.
 *
 * Compact mode (default): horizontal row of small colored pills.
 * Expanded mode (click to toggle): per-cycle detail with affect/monitor info.
 */

import React, { useState } from 'react';
import type { CognitiveTurnData, CognitiveCycleData } from './types';

export interface CycleTraceProps {
  data: CognitiveTurnData;
  isStreaming?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Color mapping                                                      */
/* ------------------------------------------------------------------ */

const COLORS = {
  exploration: '#3b82f6',   // blue  — Read, Glob, Grep
  execution:   '#10b981',   // green — Write, Edit
  monitor:     '#f59e0b',   // yellow — monitor intervention
  done:        '#7c3aed',   // purple — done / reflection
  default:     '#6b7280',   // gray  — fallback
} as const;

const EXPLORATION_ACTIONS = new Set(['Read', 'Glob', 'Grep', 'Search', 'Bash']);
const EXECUTION_ACTIONS = new Set(['Write', 'Edit', 'Create', 'Delete']);

function cycleColor(cycle: CognitiveCycleData): string {
  if (cycle.monitor) return COLORS.monitor;
  if (cycle.action === 'done' || cycle.action === 'reflect') return COLORS.done;
  if (EXPLORATION_ACTIONS.has(cycle.action)) return COLORS.exploration;
  if (EXECUTION_ACTIONS.has(cycle.action)) return COLORS.execution;
  return COLORS.default;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = {
  container: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: 1.4,
    padding: '6px 0',
  } as React.CSSProperties,

  pillRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexWrap: 'wrap' as const,
    cursor: 'pointer',
    userSelect: 'none' as const,
  } as React.CSSProperties,

  pill: (color: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    height: '20px',
    padding: '0 6px',
    borderRadius: '10px',
    background: `${color}22`,
    border: `1px solid ${color}55`,
    color,
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    letterSpacing: '0.01em',
  }),

  arrow: {
    color: 'var(--text-muted)',
    fontSize: '9px',
    opacity: 0.4,
    userSelect: 'none' as const,
  } as React.CSSProperties,

  pulsingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'var(--solar, #f59e0b)',
    display: 'inline-block',
    animation: 'cycle-trace-pulse 1.2s ease-in-out infinite',
  } as React.CSSProperties,

  expandedContainer: {
    marginTop: '6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  } as React.CSSProperties,

  cycleDetail: (color: string): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    padding: '4px 8px',
    borderLeft: `2px solid ${color}`,
    background: 'rgba(0,0,0,0.15)',
    borderRadius: '0 4px 4px 0',
  }),

  cycleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--text)',
  } as React.CSSProperties,

  cycleConfidence: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    opacity: 0.7,
  } as React.CSSProperties,

  affectLine: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    paddingLeft: '8px',
    fontStyle: 'italic' as const,
  } as React.CSSProperties,

  summaryLine: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '6px',
    fontSize: '10px',
    color: 'var(--text-muted)',
    opacity: 0.7,
  } as React.CSSProperties,

  toggleHint: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    opacity: 0.4,
    marginLeft: '4px',
  } as React.CSSProperties,
};

/* ------------------------------------------------------------------ */
/*  Keyframes (injected once)                                          */
/* ------------------------------------------------------------------ */

const pulseCSS = `
  @keyframes cycle-trace-pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.1); }
  }
`;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function CyclePill({ cycle }: { cycle: CognitiveCycleData }) {
  const color = cycleColor(cycle);
  const hasMonitor = !!cycle.monitor;
  const label = `c${cycle.number}`;

  return (
    <span style={styles.pill(color)}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      {cycle.action}
      {hasMonitor && ' \u26A0'}
      {cycle.action === 'done' && ' \u2705'}
    </span>
  );
}

function CycleDetailRow({ cycle }: { cycle: CognitiveCycleData }) {
  const color = cycleColor(cycle);

  return (
    <div style={styles.cycleDetail(color)}>
      <div style={styles.cycleHeader}>
        <span>Cycle {cycle.number}: <strong>{cycle.action}</strong></span>
        <span style={styles.cycleConfidence}>conf={cycle.confidence.toFixed(2)}</span>
        {cycle.monitor && (
          <span style={{ color: COLORS.monitor, fontSize: '10px' }}>
            {'\u26A0'} {cycle.monitor.intervention}
            {cycle.monitor.restricted?.length
              ? ` (${cycle.monitor.restricted.join(', ')} blocked)`
              : ''}
          </span>
        )}
      </div>
      {cycle.affect && (
        <div style={styles.affectLine}>
          {'\uD83D\uDCAD'} {cycle.affect.label}
          {cycle.affect.valence < 0 ? ' (negative)' : cycle.affect.valence > 0.5 ? ' (positive)' : ''}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function CycleTrace({ data, isStreaming }: CycleTraceProps) {
  const [expanded, setExpanded] = useState(false);

  if (!data.cycles.length && !isStreaming) return null;

  const totalTokens = data.cycles.reduce((sum, c) => sum + c.tokens, 0);
  const interventions = data.cycles.filter((c) => !!c.monitor).length;

  const formattedTokens =
    totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k`
      : `${totalTokens}`;

  return (
    <div style={styles.container}>
      <style>{pulseCSS}</style>

      {/* ── Compact pill row ── */}
      <div
        style={styles.pillRow}
        onClick={() => setExpanded((prev) => !prev)}
        title={expanded ? 'Click to collapse' : 'Click to expand cycle details'}
      >
        {data.cycles.map((cycle, i) => (
          <React.Fragment key={cycle.number}>
            {i > 0 && <span style={styles.arrow}>{'\u2192'}</span>}
            <CyclePill cycle={cycle} />
          </React.Fragment>
        ))}
        {isStreaming && <span style={styles.pulsingDot} />}
        <span style={styles.toggleHint}>{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={styles.expandedContainer}>
          {data.cycles.map((cycle) => (
            <CycleDetailRow key={cycle.number} cycle={cycle} />
          ))}

          {/* Memory summary */}
          {data.memory && (
            <div style={{ ...styles.affectLine, paddingLeft: 0, marginTop: '4px' }}>
              {'\uD83E\uDDE0'} Memory: {data.memory.retrieved} retrieved, {data.memory.stored} stored ({data.memory.totalCards} total cards)
            </div>
          )}

          {/* Reflection */}
          {data.reflection && data.reflection.lessons.length > 0 && (
            <div style={{ ...styles.affectLine, paddingLeft: 0, marginTop: '2px' }}>
              {'\uD83D\uDD0D'} Lessons: {data.reflection.lessons.join('; ')}
            </div>
          )}
        </div>
      )}

      {/* ── Summary line ── */}
      {data.cycles.length > 0 && (
        <div style={styles.summaryLine}>
          <span>{'\uD83D\uDCCA'} {data.cycles.length} cycles, {formattedTokens} tokens{interventions > 0 ? `, ${interventions} intervention${interventions > 1 ? 's' : ''}` : ''}</span>
          {data.profile && <span>| profile: {data.profile}</span>}
        </div>
      )}
    </div>
  );
}
