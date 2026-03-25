import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { wsManager } from './shared/websocket/ws-manager';
import { useEventStore } from './shared/stores/event-store';
import './styles/vidtecci.css';

// Connect WebSocket and sync connection state to unified event store (PRD 026 Phase 4)
wsManager.onConnectionChange((connected) => {
  useEventStore.getState().setConnected(connected);
});
wsManager.connect();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
