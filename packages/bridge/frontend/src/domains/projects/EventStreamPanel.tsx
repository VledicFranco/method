import { useEffect, useState, useRef, useMemo } from 'react';
import { useEventStore } from '@/shared/stores/event-store';
import type { ProjectEvent } from '@/domains/projects/types';

export interface EventStreamPanelProps {
  /** Optional initial project ID filter */
  initialProjectId?: string;
  /** Enable auto-scroll to latest events */
  autoScroll?: boolean;
}

// ---------------------------------------------------------------------------
// Color palette (CSS custom-property values inlined for zero-dependency styling)
// ---------------------------------------------------------------------------
const COLORS = {
  void: '#0a0e14',
  abyss: '#111923',
  bio: '#00e5a0',
  solar: '#f5a623',
  text: '#e0e8f0',
  textMuted: '#6b7d8e',
  border: 'rgba(255,255,255,0.08)',
  error: '#ff4757',
  fontMono: 'monospace',
} as const;

// ---------------------------------------------------------------------------
// Domain & Severity filters
// ---------------------------------------------------------------------------
type DomainFilter = 'all' | 'system' | 'session' | 'strategy' | 'trigger' | 'agent';
type SeverityFilter = 'all' | 'info' | 'warning' | 'error';

const DOMAIN_FILTERS: { label: string; value: DomainFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'System', value: 'system' },
  { label: 'Session', value: 'session' },
  { label: 'Strategy', value: 'strategy' },
  { label: 'Trigger', value: 'trigger' },
  { label: 'Agent', value: 'agent' },
];

const SEVERITY_FILTERS: { label: string; value: SeverityFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Error', value: 'error' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'unknown';
  }
}

function formatAbsoluteTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

function getDomainFromType(type: string): string {
  const prefix = type.split('.')[0];
  return prefix || 'unknown';
}

function deriveSeverity(event: ProjectEvent): 'info' | 'warning' | 'error' {
  const t = event.type.toLowerCase();
  if (t.includes('error') || t.includes('failed') || t.includes('crash')) return 'error';
  if (t.includes('warning') || t.includes('warn')) return 'warning';
  // Check payload for severity field
  const payloadSeverity = event.payload?.severity;
  if (typeof payloadSeverity === 'string') {
    const s = payloadSeverity.toLowerCase();
    if (s === 'error') return 'error';
    if (s === 'warning' || s === 'warn') return 'warning';
  }
  return 'info';
}

function getDotColor(event: ProjectEvent): string {
  const t = event.type.toLowerCase();
  // Error states
  if (t.includes('error') || t.includes('failed') || t.includes('crash')) return COLORS.error;
  // Warning states
  if (t.includes('warning') || t.includes('warn') || t === 'system.bus_stats') return COLORS.solar;
  // Success states
  if (
    t.includes('completed') ||
    t.includes('ready') ||
    t.includes('spawned') ||
    t === 'system.bridge_ready' ||
    t === 'session.spawned'
  ) return COLORS.bio;
  // Session prompt completed — teal/blue
  if (t === 'session.prompt.completed') return '#4ecdc4';
  // Default
  return COLORS.textMuted;
}

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).filter(
    ([key]) => key !== 'metadata' && key !== 'severity',
  );
  if (entries.length === 0) return '';

  const parts: string[] = [];
  for (const [key, value] of entries.slice(0, 3)) {
    let valStr: string;
    if (typeof value === 'string') {
      valStr = value;
    } else if (value === null || value === undefined) {
      valStr = String(value);
    } else {
      valStr = JSON.stringify(value);
    }
    parts.push(`${key}: ${valStr}`);
  }
  const summary = parts.join(' | ');
  return summary.length > 80 ? summary.slice(0, 77) + '...' : summary;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventStreamPanel({
  initialProjectId,
  autoScroll = true,
}: EventStreamPanelProps) {
  // Read ALL events from the unified event store (not just project-domain)
  const storeEvents = useEventStore((s) => s.events);
  const connected = useEventStore((s) => s.connected);
  const loading = !connected;

  // Convert BridgeEvents to ProjectEvents for the timeline
  const events: ProjectEvent[] = useMemo(() =>
    storeEvents.map((e) => ({
      id: e.id,
      projectId: e.projectId ?? '',
      type: e.type,
      timestamp: e.timestamp,
      metadata: {},
      payload: e.payload ?? {},
    })),
  [storeEvents]);

  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter events
  const filteredEvents = useMemo(() => {
    let result = events;
    if (domainFilter !== 'all') {
      result = result.filter((e) => getDomainFromType(e.type) === domainFilter);
    }
    if (severityFilter !== 'all') {
      result = result.filter((e) => deriveSeverity(e) === severityFilter);
    }
    return result;
  }, [events, domainFilter, severityFilter]);

  // Last 50, newest first
  const displayedEvents = useMemo(() => {
    return [...filteredEvents.slice(-50)].reverse();
  }, [filteredEvents]);

  // Auto-scroll to top when new events arrive (newest at top)
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events.length, autoScroll]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ---- Inline styles ----

  const rootStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const headingStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: COLORS.text,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  };

  const badgeStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 500,
    color: COLORS.textMuted,
    backgroundColor: COLORS.abyss,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '10px',
    padding: '2px 8px',
    lineHeight: '16px',
  };

  const spinnerStyle: React.CSSProperties = {
    width: '16px',
    height: '16px',
    border: `2px solid ${COLORS.border}`,
    borderTopColor: COLORS.bio,
    borderRadius: '50%',
    animation: 'event-timeline-spin 0.8s linear infinite',
  };

  const filterRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    overflowX: 'auto',
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: 500,
    borderRadius: '14px',
    border: active ? `1px solid ${COLORS.bio}` : `1px solid ${COLORS.border}`,
    backgroundColor: active ? 'rgba(0,229,160,0.1)' : COLORS.abyss,
    color: active ? COLORS.bio : COLORS.textMuted,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
    outline: 'none',
    lineHeight: '18px',
  });

  const containerStyle: React.CSSProperties = {
    maxHeight: '500px',
    overflowY: 'auto',
    borderRadius: '8px',
    border: `1px solid ${COLORS.border}`,
    backgroundColor: 'rgba(10,14,20,0.5)',
    padding: '16px',
  };

  const emptyStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: COLORS.textMuted,
    fontSize: '13px',
    textAlign: 'center',
    lineHeight: '1.6',
  };

  const timelineItemStyle = (isLast: boolean): React.CSSProperties => ({
    display: 'flex',
    gap: '12px',
    cursor: 'pointer',
    paddingBottom: isLast ? '0' : '4px',
    transition: 'background-color 0.15s ease',
  });

  const dotColumnStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flexShrink: 0,
    width: '16px',
    paddingTop: '2px',
  };

  const dotStyle = (color: string): React.CSSProperties => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: color,
    flexShrink: 0,
    boxShadow: `0 0 6px ${color}40`,
  });

  const lineStyle: React.CSSProperties = {
    width: '1px',
    flex: 1,
    backgroundColor: COLORS.border,
    marginTop: '4px',
    minHeight: '12px',
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    paddingBottom: '12px',
  };

  const topRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
  };

  const eventTypeStyle: React.CSSProperties = {
    fontFamily: COLORS.fontMono,
    fontSize: '13px',
    fontWeight: 600,
    color: COLORS.text,
    wordBreak: 'break-word',
  };

  const timestampStyle: React.CSSProperties = {
    fontSize: '11px',
    color: COLORS.textMuted,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  const summaryStyle: React.CSSProperties = {
    fontSize: '12px',
    color: COLORS.textMuted,
    marginTop: '4px',
    fontFamily: COLORS.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const expandedStyle: React.CSSProperties = {
    marginTop: '8px',
    padding: '10px',
    borderRadius: '6px',
    backgroundColor: COLORS.abyss,
    border: `1px solid ${COLORS.border}`,
    fontSize: '12px',
    fontFamily: COLORS.fontMono,
    color: COLORS.text,
    lineHeight: '1.5',
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  const expandedLabelStyle: React.CSSProperties = {
    color: COLORS.textMuted,
    fontWeight: 500,
    marginRight: '8px',
  };

  const expandedRowStyle: React.CSSProperties = {
    marginBottom: '4px',
  };

  const footerStyle: React.CSSProperties = {
    fontSize: '11px',
    color: COLORS.textMuted,
  };

  // Mobile-responsive media query via CSS-in-JS keyframes injection
  const styleTagId = 'event-timeline-styles';

  useEffect(() => {
    if (document.getElementById(styleTagId)) return;
    const style = document.createElement('style');
    style.id = styleTagId;
    style.textContent = `
      @keyframes event-timeline-spin {
        to { transform: rotate(360deg); }
      }
      @media (max-width: 480px) {
        .event-timeline-dot { width: 8px !important; height: 8px !important; }
        .event-timeline-summary { display: none !important; }
        .event-timeline-dot-col { width: 12px !important; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById(styleTagId);
      if (el) el.remove();
    };
  }, []);

  return (
    <div style={rootStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h2 style={headingStyle}>
          Event Timeline
          {filteredEvents.length > 0 && (
            <span style={badgeStyle}>{filteredEvents.length}</span>
          )}
        </h2>
        {loading && <div style={spinnerStyle} />}
      </div>

      {/* Domain filter chips */}
      <div style={filterRowStyle}>
        {DOMAIN_FILTERS.map((f) => (
          <button
            key={f.value}
            style={chipStyle(domainFilter === f.value)}
            onClick={() => setDomainFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Severity filter chips */}
      <div style={filterRowStyle}>
        {SEVERITY_FILTERS.map((f) => (
          <button
            key={f.value}
            style={chipStyle(severityFilter === f.value)}
            onClick={() => setSeverityFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline container */}
      <div ref={containerRef} style={containerStyle}>
        {displayedEvents.length === 0 ? (
          <div style={emptyStyle}>
            No events yet — events will appear as sessions and system activity occurs
          </div>
        ) : (
          displayedEvents.map((event: ProjectEvent, index: number) => {
            const isLast = index === displayedEvents.length - 1;
            const isExpanded = expandedIds.has(event.id);
            const dotColor = getDotColor(event);
            const summary = summarizePayload(event.payload);

            return (
              <div
                key={event.id}
                style={timelineItemStyle(isLast)}
                onClick={() => toggleExpanded(event.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e: { key: string; preventDefault: () => void }) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpanded(event.id);
                  }
                }}
              >
                {/* Dot column */}
                <div style={dotColumnStyle} className="event-timeline-dot-col">
                  <div style={dotStyle(dotColor)} className="event-timeline-dot" />
                  {!isLast && <div style={lineStyle} />}
                </div>

                {/* Content */}
                <div style={contentStyle}>
                  <div style={topRowStyle}>
                    <span style={eventTypeStyle}>{event.type}</span>
                    <time
                      style={timestampStyle}
                      title={formatAbsoluteTimestamp(event.timestamp)}
                    >
                      {formatTimestamp(event.timestamp)}
                    </time>
                  </div>

                  {summary && !isExpanded && (
                    <div style={summaryStyle} className="event-timeline-summary">
                      {summary}
                    </div>
                  )}

                  {isExpanded && (
                    <div style={expandedStyle}>
                      <div style={expandedRowStyle}>
                        <span style={expandedLabelStyle}>type:</span>
                        {event.type}
                      </div>
                      <div style={expandedRowStyle}>
                        <span style={expandedLabelStyle}>timestamp:</span>
                        {formatAbsoluteTimestamp(event.timestamp)}
                      </div>
                      <div style={expandedRowStyle}>
                        <span style={expandedLabelStyle}>projectId:</span>
                        {event.projectId || '(none)'}
                      </div>
                      {Object.keys(event.metadata).length > 0 && (
                        <div style={expandedRowStyle}>
                          <span style={expandedLabelStyle}>metadata:</span>
                          {JSON.stringify(event.metadata, null, 2)}
                        </div>
                      )}
                      {Object.keys(event.payload).length > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          <span style={expandedLabelStyle}>payload:</span>
                          <pre style={{ margin: '4px 0 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer event count */}
      {events.length > 0 && (
        <p style={footerStyle}>
          Showing {displayedEvents.length} of {filteredEvents.length} events
          {(domainFilter !== 'all' || severityFilter !== 'all') && ' (filtered)'}
        </p>
      )}
    </div>
  );
}
