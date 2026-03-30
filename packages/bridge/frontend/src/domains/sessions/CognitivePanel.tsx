/**
 * CognitivePanel — Cognitive state dashboard for the sidebar.
 * Only visible when the active session is a cognitive-agent session.
 * PRD 033 C-3: Cognitive State Sidebar Panel.
 * PRD 033 C-5: Memory Viewer modal trigger.
 */

import { useState } from 'react';
import type { CognitiveTurnData } from './types';
import { MemoryViewer } from './MemoryViewer';

export interface CognitivePanelProps {
  turnData: CognitiveTurnData | null;
  sessionMode: string;
}

// ── Styles (matches SessionSidebar inline-style patterns) ───────

const mono = 'var(--font-mono)';

const styles = {
  panel: {
    borderTop: '1px solid var(--border)',
    padding: '10px 12px',
    background: 'rgba(0,0,0,0.15)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    flexShrink: 0,
  },
  heading: {
    fontFamily: mono, fontSize: '11px', fontWeight: 600,
    letterSpacing: '0.08em', color: 'var(--text-muted)',
    textTransform: 'uppercase' as const, marginBottom: '2px',
  },
  metric: { fontFamily: mono, fontSize: '12px', color: 'var(--text)', lineHeight: 1.4 },
  muted: { fontFamily: mono, fontSize: '10px', color: 'var(--text-muted)' },
  barOuter: {
    width: '100%', height: '6px', borderRadius: '3px',
    background: 'rgba(138,155,176,0.15)', overflow: 'hidden' as const, marginTop: '3px',
  },
  tag: (color: string): React.CSSProperties => ({
    display: 'inline-block', fontFamily: mono, fontSize: '10px', fontWeight: 600,
    padding: '1px 5px', borderRadius: '3px', marginRight: '4px', marginTop: '3px',
    color, background: `${color}22`,
  }),
  badge: (color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    fontFamily: mono, fontSize: '11px', fontWeight: 500, color,
  }),
};

// ── Data maps ───────────────────────────────────────────────────

const AFFECT: Record<string, { emoji: string; color: string }> = {
  confident:  { emoji: '\uD83D\uDE0A', color: 'var(--bio)' },
  anxious:    { emoji: '\uD83D\uDE30', color: 'var(--solar)' },
  frustrated: { emoji: '\uD83D\uDE24', color: 'var(--error)' },
  curious:    { emoji: '\uD83E\uDD14', color: '#5b9bd5' },
  neutral:    { emoji: '\uD83D\uDE10', color: 'var(--text-muted)' },
};

const MEM_TAGS: [string, string][] = [
  ['HEURISTIC', '#c084fc'], ['OBS', 'var(--bio)'],
  ['PROC', 'var(--solar)'], ['RULE', '#5b9bd5'],
];

// ── Component ───────────────────────────────────────────────────

export function CognitivePanel({ turnData, sessionMode }: CognitivePanelProps) {
  const [memoryOpen, setMemoryOpen] = useState(false);

  if (sessionMode !== 'cognitive-agent') return null;

  const cycles = turnData?.cycles ?? [];
  const maxWs = 8;
  const used = Math.min(cycles.length, maxWs);
  const pct = Math.round((used / maxWs) * 100);

  const totalCards = turnData?.memory?.totalCards ?? 0;

  const lastAffect = [...cycles].reverse().find((c) => c.affect);
  const label = lastAffect?.affect?.label ?? 'neutral';
  const valence = lastAffect?.affect?.valence ?? 0;
  const aff = AFFECT[label] ?? AFFECT.neutral;

  const interventions = cycles.filter((c) => c.monitor?.intervention).length;
  const profile = turnData?.profile ?? 'unknown';

  return (
    <div style={styles.panel}>
      <div style={styles.heading}>Cognitive State</div>

      {/* Workspace Meter */}
      <div>
        <div style={styles.metric}>Workspace: {used}/{maxWs}</div>
        <div style={styles.barOuter}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: '3px',
            background: pct > 80 ? 'var(--solar)' : 'var(--bio)',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={styles.muted}>{pct}%</div>
      </div>

      {/* Memory Summary + View Memory Button */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={styles.metric}>Memory: {totalCards} cards</div>
          {totalCards > 0 && turnData?.memory && (
            <button
              onClick={() => setMemoryOpen(true)}
              style={{
                background: 'none',
                border: '1px solid rgba(138,155,176,0.25)',
                borderRadius: '4px',
                padding: '2px 6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontFamily: mono,
                fontSize: '10px',
                color: 'var(--text-muted)',
                transition: 'color 0.15s ease, border-color 0.15s ease',
              }}
              title="View memory cards"
              aria-label="View memory cards"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--bio)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bio)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(138,155,176,0.25)';
              }}
            >
              <span>{'\uD83E\uDDE0'}</span>
              <span>view</span>
            </button>
          )}
        </div>
        <div>
          {MEM_TAGS.map(([type, color]) => (
            <span key={type} style={styles.tag(color)}>{type}</span>
          ))}
        </div>
      </div>

      {/* Affect Indicator */}
      <div style={styles.badge(aff.color)}>
        <span>{aff.emoji}</span>
        <span>{label}</span>
        <span style={{ ...styles.muted, marginLeft: '2px' }}>v={valence.toFixed(1)}</span>
      </div>

      {/* Monitor Activity */}
      {interventions > 0 && (
        <div style={styles.badge('var(--solar)')}>
          <span>{'\u26A0'}</span>
          <span>{interventions} intervention{interventions !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Profile Badge */}
      <div style={styles.badge('#5b9bd5')}>
        <span>{'\uD83E\uDDE0'}</span>
        <span>{profile}</span>
      </div>

      {/* Memory Viewer Modal */}
      {turnData?.memory && (
        <MemoryViewer
          isOpen={memoryOpen}
          onClose={() => setMemoryOpen(false)}
          memory={turnData.memory}
        />
      )}
    </div>
  );
}
