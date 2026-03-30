/**
 * MemoryViewer — Modal displaying FactCards from cognitive session memory.
 *
 * Groups cards by epistemic type (FACT, HEURISTIC, RULE, OBSERVATION, PROCEDURE),
 * sorted by confidence descending within each group. Includes search/filter,
 * confidence bars, tag pills, and a summary-only fallback when full card data
 * is not yet available from the backend.
 *
 * PRD 033: Memory Viewer modal for cognitive sessions.
 */

import { useState, useMemo } from 'react';
import { X, Search, Brain } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { CognitiveMemoryData, MemoryCard, EpistemicType } from './types';

export interface MemoryViewerProps {
  isOpen: boolean;
  onClose: () => void;
  memory: CognitiveMemoryData;
}

// ── Constants ────────────────────────────────────────────────────

const EPISTEMIC_TYPES: EpistemicType[] = ['FACT', 'HEURISTIC', 'RULE', 'OBSERVATION', 'PROCEDURE'];

const TYPE_COLORS: Record<EpistemicType, string> = {
  FACT:        '#3b82f6',  // blue
  HEURISTIC:   '#c084fc',  // purple
  RULE:        '#5b9bd5',  // steel blue
  OBSERVATION: '#10b981',  // green (bio)
  PROCEDURE:   '#f59e0b',  // amber (solar)
};

const TYPE_ICONS: Record<EpistemicType, string> = {
  FACT:        '\u2139',   // info circle
  HEURISTIC:   '\u2728',   // sparkles
  RULE:        '\u2696',   // scales
  OBSERVATION: '\uD83D\uDC41', // eye
  PROCEDURE:   '\u2699',   // gear
};

// ── Inline styles (consistent with CognitivePanel/CycleTrace) ──

const mono = 'var(--font-mono)';

const styles = {
  cardContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    padding: '4px 0',
  },
  card: (color: string): React.CSSProperties => ({
    borderLeft: `3px solid ${color}`,
    background: 'rgba(0,0,0,0.2)',
    borderRadius: '0 6px 6px 0',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  }),
  cardContent: {
    fontFamily: mono,
    fontSize: '12px',
    color: 'var(--text)',
    lineHeight: 1.5,
  } as React.CSSProperties,
  confidenceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as React.CSSProperties,
  confidenceLabel: {
    fontFamily: mono,
    fontSize: '10px',
    color: 'var(--text-muted)',
    minWidth: '32px',
  } as React.CSSProperties,
  confidenceBarOuter: {
    flex: 1,
    height: '4px',
    borderRadius: '2px',
    background: 'rgba(138,155,176,0.15)',
    overflow: 'hidden' as const,
  } as React.CSSProperties,
  tagPill: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    fontFamily: mono,
    fontSize: '9px',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '3px',
    color,
    background: `${color}22`,
    marginRight: '4px',
  }),
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontFamily: mono,
    fontSize: '10px',
    color: 'var(--text-muted)',
    opacity: 0.7,
  } as React.CSSProperties,
  sectionHeader: (color: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: mono,
    fontSize: '11px',
    fontWeight: 600,
    color,
    letterSpacing: '0.05em',
    padding: '6px 0 2px',
    borderBottom: `1px solid ${color}33`,
    marginBottom: '4px',
  }),
  badge: {
    fontFamily: mono,
    fontSize: '10px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: '8px',
    background: 'rgba(138,155,176,0.15)',
    color: 'var(--text-muted)',
  } as React.CSSProperties,
};

// ── Helpers ──────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function groupByType(cards: MemoryCard[]): Map<EpistemicType, MemoryCard[]> {
  const map = new Map<EpistemicType, MemoryCard[]>();
  for (const card of cards) {
    const list = map.get(card.type) ?? [];
    list.push(card);
    map.set(card.type, list);
  }
  // Sort each group by confidence descending
  for (const [, list] of map) {
    list.sort((a, b) => b.confidence - a.confidence);
  }
  return map;
}

// ── Sub-components ───────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'var(--bio)' : pct >= 50 ? 'var(--solar)' : 'var(--error)';
  return (
    <div style={styles.confidenceRow}>
      <span style={styles.confidenceLabel}>{pct}%</span>
      <div style={styles.confidenceBarOuter}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: '2px',
            background: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

function FactCardView({ card }: { card: MemoryCard }) {
  const color = TYPE_COLORS[card.type] ?? '#6b7280';
  return (
    <div style={styles.card(color)}>
      <div style={styles.cardContent}>{card.content}</div>
      <ConfidenceBar value={card.confidence} />
      {card.tags.length > 0 && (
        <div>
          {card.tags.map((tag) => (
            <span key={tag} style={styles.tagPill(color)}>{tag}</span>
          ))}
        </div>
      )}
      <div style={styles.metaRow}>
        {card.source.module && <span>module: {card.source.module}</span>}
        {card.source.cycle != null && <span>cycle: {card.source.cycle}</span>}
        <span>{formatTimestamp(card.created)}</span>
      </div>
    </div>
  );
}

function SectionHeader({ type, count }: { type: EpistemicType; count: number }) {
  const color = TYPE_COLORS[type];
  return (
    <div style={styles.sectionHeader(color)}>
      <span>{TYPE_ICONS[type]}</span>
      <span>{type}</span>
      <span style={styles.badge}>{count}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 gap-3"
    >
      <Brain className="h-8 w-8 text-txt-muted opacity-30" />
      <span
        style={{
          fontFamily: mono,
          fontSize: '12px',
          color: 'var(--text-muted)',
        }}
      >
        No memory cards recorded in this session
      </span>
    </div>
  );
}

function SummaryOnlyState({ memory }: { memory: CognitiveMemoryData }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-8 gap-4"
    >
      <Brain className="h-8 w-8 text-txt-muted opacity-40" />
      <div
        style={{
          fontFamily: mono,
          fontSize: '12px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: '8px' }}>
          {memory.totalCards} card{memory.totalCards !== 1 ? 's' : ''} in memory
        </div>
        <div
          style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            fontFamily: mono,
            fontSize: '11px',
          }}
        >
          <span style={{ color: 'var(--bio)' }}>
            +{memory.stored} stored
          </span>
          <span style={{ color: '#5b9bd5' }}>
            {memory.retrieved} retrieved
          </span>
        </div>
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: '10px',
          color: 'var(--text-muted)',
          opacity: 0.5,
          textAlign: 'center',
          maxWidth: '280px',
        }}
      >
        Detailed card view will be available when the backend streams full card data.
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export function MemoryViewer({ isOpen, onClose, memory }: MemoryViewerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const cards = memory.cards ?? [];
  const hasCards = cards.length > 0;

  // Filter cards by search query
  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return cards;
    const q = searchQuery.toLowerCase();
    return cards.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.type.toLowerCase().includes(q),
    );
  }, [cards, searchQuery]);

  // Group filtered cards by type
  const grouped = useMemo(() => groupByType(filteredCards), [filteredCards]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-void/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        style={{ animation: 'memory-viewer-fade-in 0.15s ease-out' }}
      />

      {/* Keyframes */}
      <style>{`
        @keyframes memory-viewer-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes memory-viewer-slide-in {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={cn(
            'w-full max-w-2xl max-h-[80vh] rounded-xl border border-bdr bg-abyss shadow-2xl',
            'flex flex-col overflow-hidden',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Session Memory"
          onClick={(e) => e.stopPropagation()}
          style={{ animation: 'memory-viewer-slide-in 0.2s ease-out' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-bdr px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-bio" />
              <h2
                className="text-txt font-semibold"
                style={{ fontFamily: mono, fontSize: '14px' }}
              >
                Session Memory
              </h2>
              <span
                style={{
                  ...styles.badge,
                  background: 'var(--bio)',
                  color: 'var(--abyss)',
                  fontWeight: 700,
                }}
              >
                {memory.totalCards}
              </span>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
              aria-label="Close memory viewer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search bar (only when we have cards to search) */}
          {hasCards && (
            <div className="px-5 py-3 border-b border-bdr shrink-0">
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-txt-muted"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by content, tag, or type..."
                  className="w-full rounded-lg border border-bdr bg-void pl-9 pr-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                />
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!hasCards && memory.totalCards === 0 && <EmptyState />}
            {!hasCards && memory.totalCards > 0 && <SummaryOnlyState memory={memory} />}
            {hasCards && filteredCards.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-8"
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                  }}
                >
                  No cards match "{searchQuery}"
                </span>
              </div>
            )}
            {hasCards && filteredCards.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {EPISTEMIC_TYPES.map((type) => {
                  const typeCards = grouped.get(type);
                  if (!typeCards || typeCards.length === 0) return null;
                  return (
                    <div key={type}>
                      <SectionHeader type={type} count={typeCards.length} />
                      <div style={styles.cardContainer}>
                        {typeCards.map((card) => (
                          <FactCardView key={card.id} card={card} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer summary */}
          {hasCards && (
            <div
              className="border-t border-bdr px-5 py-3 shrink-0"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: mono,
                fontSize: '10px',
                color: 'var(--text-muted)',
              }}
            >
              <span>
                {filteredCards.length} of {cards.length} card{cards.length !== 1 ? 's' : ''}
                {searchQuery.trim() ? ' (filtered)' : ''}
              </span>
              <span>
                +{memory.stored} stored this turn | {memory.retrieved} retrieved
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
