import { useEffect, useRef, useState } from 'react';
import { wsManager, type MessageHandler } from '@/lib/ws-manager';

export interface UseWebSocketOptions<T> {
  /** Subscription filter passed to the server */
  filter?: Record<string, string>;
  /** Enable/disable the subscription (default: true) */
  enabled?: boolean;
  /** Callback for each incoming message */
  onMessage?: (data: T, cursor: string) => void;
}

export interface UseWebSocketResult {
  /** Whether the WebSocket connection is currently open */
  connected: boolean;
}

/**
 * Subscribe to a WebSocket topic on the bridge server.
 * Manages subscription lifecycle tied to component mount/unmount.
 */
export function useWebSocket<T = unknown>(
  topic: string,
  options: UseWebSocketOptions<T> = {},
): UseWebSocketResult {
  const { filter, enabled = true, onMessage } = options;
  const [connected, setConnected] = useState(wsManager.connected);

  // Stable callback ref
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Track connection state
  useEffect(() => {
    return wsManager.onConnectionChange(setConnected);
  }, []);

  // Subscribe to topic
  useEffect(() => {
    if (!enabled) return;

    const handler: MessageHandler = (payload, cursor) => {
      onMessageRef.current?.(payload as T, cursor);
    };

    const unsubscribe = wsManager.subscribe(topic, handler, filter);
    return unsubscribe;
    // Serialize filter to avoid re-subscribing on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, enabled, JSON.stringify(filter)]);

  return { connected };
}
