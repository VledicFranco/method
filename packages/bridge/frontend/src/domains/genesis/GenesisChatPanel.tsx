import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useSSE } from '@/shared/websocket/useSSE';
import { api } from '@/shared/lib/api';
import { useGenesisStore, GENESIS_SESSION_ID } from '@/shared/stores/genesis-store';
import type { ChatMessage } from '@/shared/stores/genesis-store';

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

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem('genesis-chat-position');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { x: 50, y: 50 };
      }
    }
    return { x: 50, y: 50 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSending, setIsSending] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);

  // Load position from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('genesis-chat-position');
    if (saved) {
      try {
        setPosition(JSON.parse(saved));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

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

  // Subscribe to SSE stream
  const { connected } = useSSE<string>(
    `/sessions/${sessionId}/stream`,
    {
      onMessage: handleMessage,
      onError: handleError,
      enabled: isOpen,
      reconnectMs: 3000,
    },
  );

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle header drag
  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const header = e.currentTarget;
    const rect = header.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Handle mouse move while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Constrain within viewport
      const maxX = window.innerWidth - 400; // Assuming minimum width
      const maxY = window.innerHeight - 200;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem('genesis-chat-position', JSON.stringify(position));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, position]);

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
    // Escape key closes the panel
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed z-50 flex flex-col rounded-lg shadow-2xl bg-void border border-bdr overflow-hidden"
      style={{
        width: '500px',
        height: '600px',
        left: `${position.x}px`,
        top: `${position.y}px`,
        // F-E-1: Mobile responsive layout
        ...(typeof window !== 'undefined' && window.innerWidth <= 768 ? {
          width: '100%',
          height: 'auto',
          left: '0',
          top: 'auto',
          bottom: '0',
          right: '0',
          borderRadius: '12px 12px 0 0',
        } : {}),
      }}
      onKeyDown={handlePanelKeyDown}
      role="dialog"
      aria-label="Genesis Chat Panel"
    >
      {/* Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className={cn(
          'flex items-center justify-between gap-2 px-sp-3 py-sp-2',
          'bg-abyss-light border-b border-bdr',
          'select-none',
          isDragging && 'cursor-grabbing',
          !isDragging && 'cursor-grab',
        )}
      >
        <div className="flex items-center gap-2 flex-1">
          <div className="font-semibold text-txt">Genesis Chat</div>
          <div
            className={cn(
              'text-xs px-2 py-1 rounded-sm',
              status === 'active'
                ? 'bg-bio-dim text-bio'
                : 'bg-txt-muted/10 text-txt-dim',
            )}
          >
            {status === 'active' ? 'Active' : 'Idle'}
          </div>
        </div>

        {/* Budget indicator */}
        <div className="flex items-center gap-1 text-xs text-txt-dim">
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
        </div>

        <button
          onClick={() => setOpen(false)}
          className="p-1 hover:bg-abyss rounded transition-colors"
          title="Close"
          tabIndex={0}
        >
          <X className="h-4 w-4 text-txt-dim" />
        </button>
      </div>

      {/* Terminal area */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto bg-void p-sp-3 font-mono text-sm text-txt-dim"
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
        {!connected && !sseError && messages.length > 1 && (
          <div className="text-txt-dim text-xs mt-2">
            [Connecting...]
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-bdr bg-abyss-light p-sp-2 flex gap-2">
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
          rows={3}
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
    </div>
  );
}
