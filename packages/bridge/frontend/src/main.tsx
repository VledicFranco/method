import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { wsManager } from './shared/websocket/ws-manager';
import { useWsStore } from './shared/websocket/ws-store';
import './styles/vidtecci.css';

// Connect WebSocket and sync connection state to Zustand store
wsManager.onConnectionChange((connected) => {
  useWsStore.getState().setConnected(connected);
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
