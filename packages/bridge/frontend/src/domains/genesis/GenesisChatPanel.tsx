import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader2, ArrowLeft, Download, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useSSE } from '@/shared/websocket/useSSE';
import { api } from '@/shared/lib/api';
import { useGenesisStore, GENESIS_SESSION_ID } from '@/shared/stores/genesis-store';
import { useIsMobile } from './useIsMobile';
import type { ChatMessage } from '@/shared/stores/genesis-store';

// ── Transcript export ─────────────────────────────────────────

function exportTranscript(messages: ChatMessage[]) {
  const lines = messages.map((msg) => {
    const prefix =
      msg.role === 'user'
        ? '**You:**'
        : msg.role === 'assistant'
          ? '**Genesis:**'
          : '*System:*';
    return `${prefix} ${msg.content}\n`;
  });

  const header = `# Genesis Chat Transcript\n\nExported: ${new Date().toISOString()}\n\n---\n\n`;
  const content = header + lines.join('\n');

  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genesis-transcript-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function GenesisChatPanel() {
  const isOpen = useGenesisStore((s) => s.isOpen);
  const setOpen = useGenesisStore((s) => s.setOpen);
  const sessionId = useGenesisStore((s) => s.sessionId) ?? GENESIS_SESSION_ID;
  const status = useGenesisStore((s) => s.status);
  const budgetPercent = useGenesisStore((s) => s.budgetPercent);
  const messages = useGenesisStore((s) => s.messages);
  const addMessage = useGenesisStore((s) => s.addMessage);
  const inputDraft = useGenesisStore((s) => s.inputDraft);
  const setInputDraft = useGenesisStore((s) => s.setInputDraft);

  const isMobile = useIsMobile();
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  /** Tracks whether SSE was previously connected (null = never connected yet). */
  const prevConnectedRef = useRef<boolean | null>(null);

  // Helper: create a ChatMessage for the store
  const createMessage = useCallback(
    (role: ChatMessage['role'], content: string): ChatMessage => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
    }),
    [],
  );

  // Seed initial system message if messages are empty
  useEffect(() => {
    if (messages.length === 0) {
      addMessage(createMessage('system', '[Genesis Chat Panel Ready]'));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE stream handler (F-P-1: Cap buffer via store's MAX_MESSAGES)
  const handleMessage = useCallback(
    (data: unknown) => {
      if (typeof data === 'string') {
        addMessage(createMessage('assistant', data));
      }
    },
    [addMessage, createMessage],
  );

  const handleError = useCallback(
    (err: Event) => {
      setSseError('Connection lost');
      console.error('SSE error:', err);
    },
    [],
  );

  // Subscribe to SSE stream — only when genesis is reachable (not disconnected)
  const genesisReachable = status !== 'disconnected';
  const { connected } = useSSE<string>(
    `/sessions/${sessionId}/stream`,
    {
      onMessage: handleMessage,
      onError: handleError,
      enabled: isOpen && genesisReachable,
      reconnectMs: 5000,
    },
  );

  // Track SSE connection state and update store status
  const setStatus = useGenesisStore((s) => s.setStatus);
  useEffect(() => {
    if (!isOpen) return;

    const prev = prevConnectedRef.current;

    if (connected && prev === false) {
      // Reconnected after a known disconnection
      addMessage(createMessage('system', '[Reconnected]'));
      setSseError(null);
      setStatus('idle');
    } else if (connected && prev === null) {
      // First connection — no banner needed
      setStatus('idle');
    } else if (!connected && prev === true) {
      // Connection dropped after being connected
      setStatus('disconnected');
      addMessage(createMessage('system', '[Reconnecting...]'));
    }

    prevConnectedRef.current = connected;
  }, [connected, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [messages]);

  // Mobile keyboard avoidance via visualViewport API
  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const keyboardHeight = window.innerHeight - viewport.height;
      inputContainerRef.current?.style.setProperty(
        'bottom', `${Math.max(0, keyboardHeight)}px`,
      );
    };

    viewport.addEventListener('resize', handleResize);
    return () => viewport.removeEventListener('resize', handleResize);
  }, [isMobile, isOpen]);

  // Handle send prompt
  const handleSendPrompt = async () => {
    if (!inputDraft.trim() || isSending) return;

    setIsSending(true);
    const promptText = inputDraft;
    setInputDraft('');

    try {
      // Add user prompt to store
      addMessage(createMessage('user', `> ${promptText}`));

      // Send to API
      const response = await api.post<{ output: string }>(`/sessions/${sessionId}/prompt`, {
        prompt: promptText,
      });

      // Add response to store
      if (response.output) {
        addMessage(createMessage('assistant', response.output));
      }

      setSseError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send prompt';
      addMessage(createMessage('system', `[Error: ${errorMsg}]`));
      setSseError(errorMsg);
      setFailedPrompt(promptText);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // Handle Enter key in textarea
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  // F-A-2: Handle keyboard navigation and focus trap
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Always render for transition — use translate to show/hide
  return (
    <div
      className={cn(
        // Base layout
        'fixed z-40 flex flex-col bg-void overflow-hidden',
        // Transition
        'transition-transform duration-300 ease-out',
        // Desktop: side panel anchored to right edge
        'top-0 right-0 h-screen w-[420px] border-l border-bdr',
        isOpen ? 'translate-x-0' : 'translate-x-full',
        // Mobile: full-screen takeover
        'max-md:inset-0 max-md:w-full max-md:h-full max-md:border-l-0 max-md:z-50',
        // Mobile: slide up from bottom instead of from right
        !isOpen && 'max-md:translate-x-0 max-md:translate-y-full',
        isOpen && 'max-md:translate-y-0',
      )}
      onKeyDown={handlePanelKeyDown}
      role="dialog"
      aria-label="Genesis Chat Panel"
      aria-hidden={!isOpen}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-sp-3 py-sp-2',
          'bg-abyss-light border-b border-bdr',
          'select-none shrink-0',
        )}
      >
        <div className="flex items-center gap-2 flex-1">
          {/* Mobile: back arrow instead of just close X */}
          {isMobile && (
            <button
              onClick={() => setOpen(false)}
              className="p-1 -ml-1 hover:bg-abyss rounded transition-colors"
              title="Back"
              tabIndex={0}
            >
              <ArrowLeft className="h-4 w-4 text-txt-dim" />
            </button>
          )}
          <div className="font-semibold text-txt">Genesis Chat</div>
          <div
            className={cn(
              'text-xs px-2 py-1 rounded-sm',
              status === 'active'
                ? 'bg-bio-dim text-bio'
                : status === 'disconnected'
                  ? 'bg-error/20 text-error'
                  : 'bg-txt-muted/10 text-txt-dim',
            )}
          >
            {status === 'active' ? 'Active' : status === 'disconnected' ? 'Offline' : 'Idle'}
          </div>
        </div>

        {/* Budget indicator + export */}
        <div className="flex items-center gap-2 text-xs text-txt-dim">
          <span>{Math.round(budgetPercent)}%</span>
          <div className="w-20 h-1.5 bg-txt-muted/20 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                budgetPercent > 80 ? 'bg-error' : 'bg-bio',
              )}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
          <button
            onClick={() => exportTranscript(messages)}
            disabled={messages.length === 0}
            className={cn(
              'p-1 rounded transition-colors',
              messages.length === 0
                ? 'text-txt-muted cursor-not-allowed'
                : 'text-txt-dim hover:text-txt hover:bg-abyss',
            )}
            title="Export transcript"
            tabIndex={0}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Desktop: X close button */}
        {!isMobile && (
          <button
            onClick={() => setOpen(false)}
            className="p-1 hover:bg-abyss rounded transition-colors"
            title="Close"
            tabIndex={0}
          >
            <X className="h-4 w-4 text-txt-dim" />
          </button>
        )}
      </div>

      {/* Terminal area — fills remaining space, scrolls */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto bg-void p-sp-3 font-mono text-sm text-txt-dim min-h-0"
      >
        {messages.map((msg) => (
          <div key={msg.id} className="whitespace-pre-wrap break-words">
            {msg.content || <br />}
          </div>
        ))}
        {sseError && (
          <div className="text-error text-xs mt-2" role="alert" aria-live="polite" aria-atomic="true">
            [Connection Error: {sseError}]
          </div>
        )}
        {failedPrompt && (
          <button
            onClick={() => {
              setInputDraft(failedPrompt);
              setFailedPrompt(null);
              setSseError(null);
              inputRef.current?.focus();
            }}
            className={cn(
              'inline-flex items-center gap-1.5 mt-1 px-2 py-1 rounded text-xs',
              'bg-error/10 text-error hover:bg-error/20 transition-colors',
            )}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        )}
        {!connected && !sseError && messages.length > 1 && (
          <div className="text-txt-dim text-xs mt-2">
            [Connecting...]
          </div>
        )}
      </div>

      {/* Input area — sticky at bottom, keyboard-aware on mobile */}
      {status === 'disconnected' ? (
        <div
          className={cn(
            'border-t border-bdr bg-abyss-light p-sp-3 shrink-0',
            'flex items-center justify-center gap-2 text-sm text-txt-muted',
          )}
        >
          <WifiOff className="h-4 w-4" />
          <span>Bridge disconnected — waiting for reconnect</span>
        </div>
      ) : (
        <div
          ref={inputContainerRef}
          className={cn(
            'border-t border-bdr bg-abyss-light p-sp-2 flex gap-2 shrink-0',
            // Mobile: position relative for keyboard avoidance (bottom adjusted via JS)
            isMobile && 'relative',
          )}
        >
          <textarea
            ref={inputRef}
            value={inputDraft}
            onChange={(e) => setInputDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a prompt (Shift+Enter for newline)..."
            className={cn(
              'flex-1 bg-void text-txt text-sm',
              'border border-bdr rounded px-sp-2 py-sp-1.5',
              'focus:outline-none focus:ring-2 focus:ring-bio focus:border-bio',
              'resize-none',
            )}
            rows={isMobile ? 2 : 3}
            disabled={isSending}
            tabIndex={0}
          />
          <button
            onClick={handleSendPrompt}
            disabled={isSending || !inputDraft.trim()}
            className={cn(
              'self-end px-sp-2 py-sp-1.5 rounded',
              'transition-colors',
              isSending || !inputDraft.trim()
                ? 'bg-txt-muted/20 text-txt-muted cursor-not-allowed'
                : 'bg-bio text-void hover:bg-bio/90 active:bg-bio/80',
            )}
            title="Send prompt (Enter)"
            tabIndex={0}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
