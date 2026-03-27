/**
 * PromptInput — single-line prompt bar for sending messages to a session.
 * Styled with a `›` caret, monospace input, and a `send ↵` button.
 */

import { useState, useCallback, type KeyboardEvent } from 'react';
import type { PromptResult } from './types';

export interface PromptInputProps {
  sessionId: string;
  disabled?: boolean;
  onSend: (prompt: string) => Promise<PromptResult>;
  placeholder?: string;
}

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    background: 'var(--abyss)',
    borderTop: '1px solid var(--border)',
    padding: '8px 12px',
  },
  caret: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    color: 'var(--bio)',
    fontWeight: 700,
    userSelect: 'none' as const,
    marginRight: '8px',
    flexShrink: 0,
  },
  input: (disabled: boolean): React.CSSProperties => ({
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: disabled ? 'var(--text-muted)' : 'var(--text)',
    caretColor: 'var(--bio)',
    minWidth: 0,
  }),
  sendBtn: (disabled: boolean): React.CSSProperties => ({
    marginLeft: '10px',
    padding: '4px 10px',
    background: disabled ? 'var(--abyss-light)' : 'var(--bio)',
    color: disabled ? 'var(--text-muted)' : 'var(--abyss)',
    border: 'none',
    borderRadius: '5px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s ease, color 0.15s ease',
    whiteSpace: 'nowrap' as const,
  }),
};

export function PromptInput({
  sessionId: _sessionId,
  disabled = false,
  onSend,
  placeholder = 'Send a prompt…',
}: PromptInputProps) {
  const [value, setValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const canSubmit = !disabled && !isLoading && value.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || disabled) return;

    setIsLoading(true);
    try {
      await onSend(trimmed);
      setValue('');
    } catch {
      // On error: re-enable input, preserve value
    } finally {
      setIsLoading(false);
    }
  }, [value, isLoading, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const inputDisabled = disabled || isLoading;
  const btnDisabled = !canSubmit;

  return (
    <div style={styles.wrapper}>
      <span style={styles.caret} aria-hidden="true">
        ›
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={inputDisabled}
        aria-label="Prompt input"
        style={styles.input(inputDisabled)}
      />
      <button
        onClick={handleSubmit}
        disabled={btnDisabled}
        aria-label="Send prompt"
        style={styles.sendBtn(btnDisabled)}
      >
        send ↵
      </button>
    </div>
  );
}
