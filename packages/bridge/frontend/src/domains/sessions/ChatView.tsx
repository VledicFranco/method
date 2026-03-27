/**
 * ChatView — renders a list of ChatTurn items for a session.
 * Supports historical, live, and pending turn kinds.
 * Auto-scrolls to bottom when turns change.
 */

import { useRef, useEffect } from 'react';
import type { ChatTurn, SessionSummary } from './types';

export interface ChatViewProps {
  session: SessionSummary;
  turns: ChatTurn[];
  isWorking: boolean;
}

const styles = {
  container: {
    flex: 1,
    overflowY: 'auto' as const,
    background: 'var(--void)',
    backgroundImage:
      'radial-gradient(circle, rgba(138,155,176,0.08) 1px, transparent 1px)',
    backgroundSize: '20px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '16px',
    gap: '16px',
  },
  turnBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  promptHeader: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--bio)',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  promptText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--bio)',
    opacity: 0.9,
  },
  outputBlock: {
    background: 'var(--abyss)',
    borderLeft: '3px solid var(--bio)',
    borderRadius: '0 6px 6px 0',
    padding: '10px 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text)',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  chipsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
    marginTop: '4px',
  },
  chip: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--text-muted)',
    background: 'var(--abyss)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
  pendingDots: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 12px',
  },
  terminatedNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: 'var(--error-dim)',
    border: '1px solid var(--error)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--error)',
    marginTop: '4px',
  },
  scrollAnchor: {
    height: '1px',
    flexShrink: 0,
  },
};

/** Animated pending dots */
function PendingDots() {
  return (
    <>
      <style>{`
        @keyframes dot-bounce {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .chat-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--solar);
          display: inline-block;
          animation: dot-bounce 1.4s ease-in-out infinite;
        }
        .chat-dot:nth-child(2) { animation-delay: 0.2s; }
        .chat-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <div style={styles.pendingDots} aria-label="Working…">
        <span className="chat-dot" />
        <span className="chat-dot" />
        <span className="chat-dot" />
      </div>
    </>
  );
}

/** Format duration_ms → "Xs" */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format cache tokens → "Nk cached" */
function formatCached(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k cached`;
  return `${tokens} cached`;
}

export function ChatView({ session, turns, isWorking }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, isWorking]);

  return (
    <div style={styles.container}>
      {turns.map((turn, i) => {
        if (turn.kind === 'historical') {
          return (
            <div key={i} style={styles.turnBlock}>
              <div style={styles.promptHeader}>
                <span>▸</span>
                <span style={styles.promptText}>{turn.prompt}</span>
              </div>
              <div style={styles.outputBlock}>{turn.output}</div>
            </div>
          );
        }

        if (turn.kind === 'live') {
          const m = turn.metadata;
          return (
            <div key={i} style={styles.turnBlock}>
              <div style={styles.promptHeader}>
                <span>▸</span>
                <span style={styles.promptText}>{turn.prompt}</span>
              </div>
              <div style={styles.outputBlock}>{turn.output}</div>
              <div style={styles.chipsRow}>
                <span style={styles.chip}>${m.cost_usd.toFixed(2)}</span>
                <span style={styles.chip}>{m.num_turns} turns</span>
                <span style={styles.chip}>{formatDuration(m.duration_ms)}</span>
                <span style={styles.chip}>{formatCached(m.cache_read_tokens)}</span>
                {m.stop_reason && (
                  <span style={styles.chip}>{m.stop_reason}</span>
                )}
              </div>
            </div>
          );
        }

        if (turn.kind === 'pending') {
          return (
            <div key={i} style={styles.turnBlock}>
              <div style={styles.promptHeader}>
                <span>▸</span>
                <span style={styles.promptText}>{turn.prompt}</span>
              </div>
              <PendingDots />
            </div>
          );
        }

        return null;
      })}

      {/* Terminated notice */}
      {session.status === 'dead' && turns.length > 0 && (
        <div style={styles.terminatedNotice}>
          <span>⊗</span>
          <span>session terminated</span>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} style={styles.scrollAnchor} />
    </div>
  );
}
