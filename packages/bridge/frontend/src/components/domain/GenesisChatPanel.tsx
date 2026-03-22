import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSSE } from '@/hooks/useSSE';
import { api } from '@/lib/api';

interface GenesisChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  status: 'active' | 'idle';
  budgetPercent: number;
}

export function GenesisChatPanel({
  isOpen,
  onClose,
  sessionId,
  status,
  budgetPercent,
}: GenesisChatPanelProps) {
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
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['[Genesis Chat Panel Ready]', '']);
  const [inputValue, setInputValue] = useState('');
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

  // SSE stream handler
  const handleMessage = useCallback(
    (data: unknown) => {
      if (typeof data === 'string') {
        setTerminalOutput((prev) => [...prev, data]);
      }
    },
    [],
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
  }, [terminalOutput]);

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
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    const promptText = inputValue;
    setInputValue('');

    try {
      // Add user prompt to terminal
      setTerminalOutput((prev) => [...prev, `> ${promptText}`, '']);

      // Send to API
      const response = await api.post<{ output: string }>(`/sessions/${sessionId}/prompt`, {
        prompt: promptText,
      });

      // Add response to terminal
      if (response.output) {
        setTerminalOutput((prev) => [...prev, response.output, '']);
      }

      setSseError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send prompt';
      setTerminalOutput((prev) => [...prev, `[Error: ${errorMsg}]`, '']);
      setSseError(errorMsg);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
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
      }}
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
          onClick={onClose}
          className="p-1 hover:bg-abyss rounded transition-colors"
          title="Close"
        >
          <X className="h-4 w-4 text-txt-dim" />
        </button>
      </div>

      {/* Terminal area */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto bg-void p-sp-3 font-mono text-sm text-txt-dim"
      >
        {terminalOutput.map((line, idx) => (
          <div key={idx} className="whitespace-pre-wrap break-words">
            {line || <br />}
          </div>
        ))}
        {sseError && (
          <div className="text-error text-xs mt-2">
            [Connection Error: {sseError}]
          </div>
        )}
        {!connected && !sseError && terminalOutput.length > 1 && (
          <div className="text-txt-dim text-xs mt-2">
            [Connecting...]
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-bdr bg-abyss-light p-sp-2 flex gap-2">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a prompt (Shift+Enter for newline)..."
          className={cn(
            'flex-1 bg-void text-txt text-sm',
            'border border-bdr rounded px-sp-2 py-sp-1.5',
            'focus:outline-none focus:ring-2 focus:ring-bio focus:border-bio',
            'resize-none',
          )}
          rows={3}
          disabled={isSending}
        />
        <button
          onClick={handleSendPrompt}
          disabled={isSending || !inputValue.trim()}
          className={cn(
            'self-end px-sp-2 py-sp-1.5 rounded',
            'transition-colors',
            isSending || !inputValue.trim()
              ? 'bg-txt-muted/20 text-txt-muted cursor-not-allowed'
              : 'bg-bio text-void hover:bg-bio/90 active:bg-bio/80',
          )}
          title="Send prompt (Enter)"
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
