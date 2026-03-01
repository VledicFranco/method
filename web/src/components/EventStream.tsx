'use client';

import { useEffect, useState } from 'react';
import { getRecentEvents } from '../lib/api-client';
import type { PhaseEvent } from '../lib/types';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function eventDescription(ev: PhaseEvent): string {
  switch (ev.event) {
    case 'session_started': {
      const method = ev.payload.methodology as string | undefined;
      return `Session started${method ? ` — ${method}` : ''}`;
    }
    case 'phase_advanced': {
      const name = ev.payload.phase_name as string | undefined;
      return `Advanced${name ? ` — ${name}` : ''} (phase ${ev.phase_index})`;
    }
    case 'validation_failed': {
      const failed = ev.payload.failed_invariants as string[] | undefined;
      const count = failed?.length ?? 0;
      return `Validation failed — ${count} invariant${count !== 1 ? 's' : ''} (phase ${ev.phase_index})`;
    }
    default:
      return ev.event;
  }
}

function dotClass(event: PhaseEvent['event']): string {
  if (event === 'session_started') return 'event-dot event-dot-started';
  if (event === 'phase_advanced') return 'event-dot event-dot-advanced';
  return 'event-dot event-dot-failed';
}

export function EventStream() {
  const [events, setEvents] = useState<PhaseEvent[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await getRecentEvents(40);
        if (!cancelled) setEvents(data);
      } catch {
        // server may not be up
      }
    }

    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="event-stream-panel">
      <div className="event-stream-header">
        <h2>Event Stream</h2>
        <span className="event-stream-count">{events.length} events</span>
      </div>
      <div className="event-stream-body">
        {events.length === 0 ? (
          <div className="event-stream-empty">No events yet.</div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="event-entry">
              <div className={dotClass(ev.event)} />
              <div className="event-text">
                <div className="event-session-id">{ev.session_id}</div>
                <div className="event-desc">{eventDescription(ev)}</div>
              </div>
              <div className="event-time">{timeAgo(ev.created_at)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
