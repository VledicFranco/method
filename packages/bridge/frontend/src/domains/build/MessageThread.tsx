/**
 * MessageThread — Reply context indicator shown above the textarea.
 *
 * When replying to a message: shows "Replying to: [truncated message]"
 * with a cancel button. Reply messages in the chat render with a left
 * border accent connecting to the parent.
 *
 * @see PRD 047 §Conversation Panel — Message Threading
 */

import { cn } from '@/shared/lib/cn';

export interface ReplyContext {
  /** ID of the message being replied to */
  messageId: string;
  /** Preview text (truncated) of the parent message */
  preview: string;
}

export interface MessageThreadProps {
  replyContext: ReplyContext | null;
  onCancel: () => void;
}

export function MessageThread({ replyContext, onCancel }: MessageThreadProps) {
  if (!replyContext) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[11px] text-[#64748b]',
        'bg-[#ffffff06] px-2.5 py-1.5',
        'rounded-t-[5px] border border-bdr border-b-0',
      )}
    >
      <span className="text-txt-dim">Replying to:</span>
      <span className="flex-1 truncate text-txt-dim italic">
        {replyContext.preview}
      </span>
      <button
        onClick={onCancel}
        className="bg-transparent border-none text-[#64748b] cursor-pointer text-xs hover:text-[#ef4444] transition-colors px-1"
        aria-label="Cancel reply"
      >
        &#10005;
      </button>
    </div>
  );
}
