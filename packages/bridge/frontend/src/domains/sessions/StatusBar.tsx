/**
 * StatusBar — collapsible session info bar at the bottom of the session view.
 * Collapsed: single row summary. Expanded: full detail panel slides up.
 */

import { useState } from 'react';
import type { SessionSummary } from './types';

export interface StatusBarProps {
  session: SessionSummary;
  totalCost?: number;
}

/** Returns a human-readable relative time string, e.g. "2m ago", "1h ago" */
function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = {
  container: (isExpanded: boolean): React.CSSProperties => ({
    position: 'relative',
    height: isExpanded ? '220px' : '30px',
    transition: 'height 0.2s ease',
    background: 'var(--abyss)',
    borderTop: '1px solid var(--border)',
    overflow: 'hidden',
    flexShrink: 0,
  }),
  collapsedRow: {
    display: 'flex',
    alignItems: 'center',
    height: '30px',
    padding: '0 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text-muted)',
    gap: '0',
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
  },
  collapsedText: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--bio)',
    fontSize: '14px',
    lineHeight: 1,
    padding: '2px 0 2px 8px',
    flexShrink: 0,
    fontFamily: 'var(--font-mono)',
  },
  expandedPanel: {
    position: 'absolute' as const,
    bottom: '30px',
    left: 0,
    right: 0,
    top: 0,
    background: 'var(--abyss)',
    borderBottom: '1px solid var(--border)',
    padding: '12px 14px',
    overflowY: 'auto' as const,
  },
  expandedTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    marginBottom: '8px',
  },
  fieldRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '5px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  fieldLabel: {
    color: 'var(--text-muted)',
    flexShrink: 0,
    width: '90px',
  },
  fieldValue: {
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  },
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.fieldRow}>
      <span style={styles.fieldLabel}>{label}</span>
      <span style={styles.fieldValue}>{value}</span>
    </div>
  );
}

export function StatusBar({ session, totalCost }: StatusBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const shortId = `${(session.session_id ?? '').slice(0, 8)}…`;
  const cost = totalCost ?? (
    typeof session.metadata?.cost_usd === 'number'
      ? (session.metadata.cost_usd as number)
      : 0
  );

  const projectName = session.workdir
    ? session.workdir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
    : '';

  const collapsedSummary = [
    session.nickname,
    ...(projectName ? [projectName] : []),
    shortId,
    `${session.prompt_count} prompts`,
    `$${cost.toFixed(3)}`,
    timeAgo(session.last_activity_at),
  ].join(' · ');

  return (
    <div style={styles.container(isExpanded)}>
      {/* Expanded panel — slides in above the collapsed bar */}
      {isExpanded && (
        <div style={styles.expandedPanel}>
          <div style={styles.expandedTitle}>Session Details</div>
          <Field label="Session ID" value={session.session_id} />
          <Field label="Workdir" value={session.workdir} />
          <Field label="Isolation" value={session.isolation} />
          <Field label="Last activity" value={timeAgo(session.last_activity_at)} />
          <Field label="Total cost" value={`$${cost.toFixed(4)}`} />
          <Field label="Prompts" value={String(session.prompt_count)} />
        </div>
      )}

      {/* Collapsed row — always visible */}
      <div style={styles.collapsedRow}>
        <span style={styles.collapsedText}>{collapsedSummary}</span>
        <button
          style={styles.toggleBtn}
          onClick={() => setIsExpanded((v) => !v)}
          aria-label={isExpanded ? 'Collapse status bar' : 'Expand status bar'}
          aria-expanded={isExpanded}
        >
          {isExpanded ? '⊖' : '⊕'}
        </button>
      </div>
    </div>
  );
}
