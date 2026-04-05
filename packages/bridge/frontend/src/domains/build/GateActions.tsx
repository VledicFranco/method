/**
 * GateActions — Per-gate action buttons rendered in the conversation input area.
 *
 * Dynamically renders buttons based on the current gate type using the
 * GATE_ACTIONS map from types.ts. When no gate is active, only [Send].
 *
 * Button styles:
 *   - approve actions: green
 *   - reject/changes: amber
 *   - abort/destructive: red
 *   - retry/neutral: blue
 *   - send: primary purple
 *
 * @see PRD 047 §Conversation Panel — Gate Actions
 */

import { cn } from '@/shared/lib/cn';
import { GATE_ACTIONS } from './types';
import type { GateType } from './types';

// ── Button style map ──

function buttonStyle(label: string): string {
  const lower = label.toLowerCase();

  if (lower.includes('abort')) {
    return 'bg-[#ef444422] text-[#ef4444] border border-[#ef444433] hover:bg-[#ef444433]';
  }
  if (lower.includes('request changes') || lower.includes('fix manually')) {
    return 'bg-[#f59e0b22] text-[#f59e0b] border border-[#f59e0b33] hover:bg-[#f59e0b33]';
  }
  if (lower.includes('retry')) {
    return 'bg-[#3b82f622] text-[#3b82f6] border border-[#3b82f633] hover:bg-[#3b82f633]';
  }
  if (lower.includes('approve')) {
    return 'bg-[#10b98122] text-[#10b981] border border-[#10b98133] hover:bg-[#10b98133]';
  }
  if (lower.includes('with comments')) {
    return 'bg-[#ffffff08] text-txt-dim border border-bdr hover:bg-[#ffffff12]';
  }
  // Default: primary
  return 'bg-[#6d5aed] text-white border-none hover:bg-[#7d6cf7]';
}

// ── Main Export ──

export interface GateActionsProps {
  /** Current active gate type, or undefined if no gate is active */
  activeGate?: GateType;
  /** Called when any action button is clicked */
  onAction: (action: string) => void;
  /** Called when Send is clicked */
  onSend: () => void;
  /** Whether the send button should be disabled */
  sendDisabled?: boolean;
}

export function GateActions({ activeGate, onAction, onSend, sendDisabled }: GateActionsProps) {
  const gateActions = activeGate ? GATE_ACTIONS[activeGate] : [];

  return (
    <div className="flex gap-1.5 shrink-0 flex-wrap">
      {/* Send button (always present) */}
      <button
        onClick={onSend}
        disabled={sendDisabled}
        className={cn(
          'px-3.5 py-2 rounded-[5px] text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-all duration-150',
          sendDisabled
            ? 'bg-[#ffffff08] text-[#64748b] cursor-not-allowed'
            : 'bg-[#6d5aed] text-white hover:bg-[#7d6cf7]',
        )}
      >
        Send
      </button>

      {/* Gate-specific action buttons */}
      {gateActions.map((action) => (
        <button
          key={action}
          onClick={() => onAction(action)}
          className={cn(
            'px-3.5 py-2 rounded-[5px] text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-all duration-150',
            buttonStyle(action),
          )}
        >
          {action}
        </button>
      ))}
    </div>
  );
}
