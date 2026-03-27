/**
 * PromptInput tests — uses vitest + @testing-library/react.
 *
 * HOW TO RUN:
 *   These tests require vitest and @testing-library/react to be installed and
 *   a vitest.config.ts to be set up in packages/bridge/frontend/.
 *
 *   Install deps (if not already):
 *     cd packages/bridge/frontend
 *     npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
 *
 *   Create packages/bridge/frontend/vitest.config.ts:
 *     import { defineConfig } from 'vitest/config';
 *     export default defineConfig({
 *       test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
 *     });
 *
 *   Create packages/bridge/frontend/vitest.setup.ts:
 *     import '@testing-library/jest-dom';
 *
 *   Then run:
 *     npx vitest run src/domains/sessions/PromptInput.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PromptInput } from './PromptInput';
import type { PromptResult } from './types';

const successResult: PromptResult = {
  output: 'Hello!',
  timed_out: false,
  metadata: null,
};

function makeOnSend(result: PromptResult = successResult, delay = 0) {
  return vi.fn(
    (_prompt: string): Promise<PromptResult> =>
      new Promise((resolve) => setTimeout(() => resolve(result), delay)),
  );
}

function renderInput(props: {
  onSend?: (prompt: string) => Promise<PromptResult>;
  disabled?: boolean;
  placeholder?: string;
} = {}) {
  const { onSend = makeOnSend(), disabled = false, placeholder } = props;
  return {
    onSend,
    ...render(
      <PromptInput
        sessionId="sess-0001"
        onSend={onSend}
        disabled={disabled}
        placeholder={placeholder}
      />,
    ),
  };
}

describe('PromptInput', () => {
  it('Enter key calls onSend with trimmed value', async () => {
    const onSend = makeOnSend();
    renderInput({ onSend });

    const input = screen.getByLabelText('Prompt input');
    fireEvent.change(input, { target: { value: '  hello world  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello world'));
  });

  it('button click calls onSend', async () => {
    const onSend = makeOnSend();
    renderInput({ onSend });

    const input = screen.getByLabelText('Prompt input');
    fireEvent.change(input, { target: { value: 'click test' } });

    const btn = screen.getByLabelText('Send prompt');
    fireEvent.click(btn);

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('click test'));
  });

  it('second submit while in-flight: onSend called only once', async () => {
    const onSend = makeOnSend(successResult, 100);
    renderInput({ onSend });

    const input = screen.getByLabelText('Prompt input');
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Try to submit again immediately — should be blocked
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  it('disabled=true: input and button both have disabled attribute', () => {
    renderInput({ disabled: true });

    const input = screen.getByLabelText('Prompt input');
    const btn = screen.getByLabelText('Send prompt');

    expect(input).toBeDisabled();
    expect(btn).toBeDisabled();
  });

  it('after successful send: input is cleared', async () => {
    const onSend = makeOnSend();
    renderInput({ onSend });

    const input = screen.getByLabelText('Prompt input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'clear me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input.value).toBe(''));
  });

  it('empty input: Enter does not call onSend', () => {
    const onSend = makeOnSend();
    renderInput({ onSend });

    const input = screen.getByLabelText('Prompt input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });
});
