import { useEffect, useRef, useState } from 'react';

export interface UseSSEOptions<T> {
  /** Callback for each incoming message */
  onMessage: (data: T) => void;
  /** Callback on connection error */
  onError?: (error: Event) => void;
  /** Enable/disable the subscription */
  enabled?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectMs?: number;
}

export interface UseSSEResult {
  /** Whether the SSE connection is currently open */
  connected: boolean;
  /** Last connection error, if any */
  error: Event | null;
}

/**
 * Generic SSE subscription hook.
 * Connects to the given URL and calls onMessage for each event.
 * Auto-reconnects on connection loss.
 */
export function useSSE<T = string>(
  url: string,
  options: UseSSEOptions<T>,
): UseSSEResult {
  const { onMessage, onError, enabled = true, reconnectMs = 3000 } = options;
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Event | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable references to callbacks
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function connect() {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as T;
          onMessageRef.current(parsed);
        } catch {
          // If not JSON, pass raw data (cast — caller specified T)
          onMessageRef.current(event.data as T);
        }
      };

      es.onerror = (err) => {
        setConnected(false);
        setError(err);
        onErrorRef.current?.(err);
        es.close();

        // Auto-reconnect
        reconnectTimerRef.current = setTimeout(connect, reconnectMs);
      };
    }

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnected(false);
    };
  }, [url, enabled, reconnectMs]);

  return { connected, error };
}
