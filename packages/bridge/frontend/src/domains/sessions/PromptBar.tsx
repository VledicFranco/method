/**
 * Prompt input bar for sending messages to a live bridge session.
 * Ported from the old dashboard's live-output page — now a pluggable component.
 */

import { useState, useCallback, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/cn';
import { Send, Loader2 } from 'lucide-react';
import type { PromptResponse } from '@/domains/sessions/types';

export interface PromptBarProps {
  sessionId: string;
  /** Disable input (e.g. session is dead) */
  disabled?: boolean;
  /** Callback after a successful prompt/response cycle */
  onResponse?: (response: PromptResponse) => void;
  className?: string;
}

export function PromptBar({
  sessionId,
  disabled = false,
  onResponse,
  className,
}: PromptBarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mutation = useMutation({
    mutationFn: (prompt: string) =>
      api.post<PromptResponse>(`/sessions/${sessionId}/prompt`, { prompt }),
    onSuccess: (data) => {
      onResponse?.(data);
      setInput('');
      inputRef.current?.focus();
    },
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || mutation.isPending) return;
      mutation.mutate(trimmed);
    },
    [input, mutation],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter or Cmd+Enter to submit
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed && !mutation.isPending) {
          mutation.mutate(trimmed);
        }
      }
    },
    [input, mutation],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex items-end gap-2 rounded-lg border border-bdr bg-void p-2',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a prompt... (Ctrl+Enter)"
        disabled={disabled || mutation.isPending}
        rows={1}
        className="flex-1 resize-none bg-transparent text-sm text-txt font-mono placeholder:text-txt-muted focus:outline-none min-h-[2rem] max-h-[8rem]"
        style={{ fieldSizing: 'content' } as React.CSSProperties}
      />
      <button
        type="submit"
        disabled={disabled || mutation.isPending || !input.trim()}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          input.trim() && !mutation.isPending
            ? 'bg-bio text-void hover:bg-bio/90'
            : 'bg-abyss-light text-txt-muted',
        )}
        aria-label="Send prompt"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </form>
  );
}
