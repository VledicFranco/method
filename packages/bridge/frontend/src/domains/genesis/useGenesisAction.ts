import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGenesisStore } from '@/shared/stores/genesis-store';
import type { GenesisAction } from '@/shared/stores/genesis-store';

/**
 * Subscribe to Genesis actions dispatched via the store.
 * Call from pages to handle actions relevant to their domain.
 *
 * The hook reacts to pendingAction changes and consumes the action.
 * Universal actions (navigate, toast, highlight) are handled here.
 * Domain-specific actions are passed to the optional callback.
 *
 * @param onAction - Optional callback for domain-specific action handling
 */
export function useGenesisAction(onAction?: (action: GenesisAction) => void) {
  const pendingAction = useGenesisStore((s) => s.pendingAction);
  const consumeAction = useGenesisStore((s) => s.consumeAction);
  const navigate = useNavigate();

  useEffect(() => {
    if (!pendingAction) return;

    // Consume the action immediately to prevent re-processing
    const action = consumeAction();
    if (!action) return;

    // Handle universal actions
    switch (action.type) {
      case 'navigate':
        navigate(action.path);
        return;

      case 'toast':
        showToast(action.message, action.severity);
        return;

      case 'highlight':
        highlightElement(action.selector, action.duration);
        return;

      default:
        // Pass domain-specific actions to the callback
        onAction?.(action);
    }
  }, [pendingAction, consumeAction, navigate, onAction]);
}

// ── Toast helper ──────────────────────────────────────────────

function showToast(message: string, severity: 'info' | 'warning' | 'error') {
  // Simple DOM-based toast — keeps this dependency-free
  const toast = document.createElement('div');
  toast.className = [
    'fixed top-4 right-4 z-[9999] px-4 py-3 rounded-lg shadow-lg',
    'text-sm font-medium transition-all duration-300',
    'animate-in slide-in-from-top-2',
    severity === 'error' ? 'bg-error text-white' :
    severity === 'warning' ? 'bg-amber-500 text-white' :
    'bg-abyss-light text-txt border border-bdr',
  ].join(' ');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Highlight helper ──────────────────────────────────────────

function highlightElement(selector: string, duration: number = 2000) {
  const el = document.querySelector(selector);
  if (!el) return;

  el.classList.add('ring-2', 'ring-bio', 'ring-offset-2', 'ring-offset-void', 'transition-all');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setTimeout(() => {
    el.classList.remove('ring-2', 'ring-bio', 'ring-offset-2', 'ring-offset-void', 'transition-all');
  }, duration);
}
