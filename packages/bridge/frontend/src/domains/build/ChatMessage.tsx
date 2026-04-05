/**
 * ChatMessage — Individual message rendering in the conversation panel.
 *
 * 3 sender types:
 *   - agent: green avatar "B", reply button, can contain StructuredCard
 *   - human: blue avatar "F"
 *   - system: gray avatar "S", centered-ish, smaller text
 *
 * @see PRD 047 §Conversation Panel — Message Rendering
 */

import { cn } from '@/shared/lib/cn';
import { StructuredCard } from './StructuredCard';
import type { ConversationMessage } from './types';

// ── Inline code rendering ──

/** Renders backtick-delimited `code` spans as styled inline code. */
function renderContent(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="bg-[#ffffff0a] text-[#e2e8f0] px-1 py-0.5 rounded-[3px] text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Avatar ──

function Avatar({ sender }: { sender: ConversationMessage['sender'] }) {
  const config = {
    agent: { bg: 'bg-[#6d5aed33]', text: 'text-[#6d5aed]', letter: 'B' },
    human: { bg: 'bg-[#10b98122]', text: 'text-[#10b981]', letter: 'F' },
    system: { bg: 'bg-[#ffffff08]', text: 'text-[#64748b]', letter: 'S' },
  };

  const c = config[sender];

  return (
    <div
      className={cn(
        'w-6 h-6 rounded-[6px] flex items-center justify-center text-[11px] font-bold shrink-0',
        c.bg,
        c.text,
      )}
    >
      {c.letter}
    </div>
  );
}

// ── Sender Name ──

function SenderName({ sender }: { sender: ConversationMessage['sender'] }) {
  const config = {
    agent: { name: 'Build', color: 'text-[#6d5aed]' },
    human: { name: 'Franco', color: 'text-[#10b981]' },
    system: { name: 'System', color: 'text-[#64748b]' },
  };

  const c = config[sender];

  return (
    <span className={cn('text-xs font-semibold', c.color)}>{c.name}</span>
  );
}

// ── Main Export ──

export interface ChatMessageProps {
  message: ConversationMessage;
  onReply?: (messageId: string) => void;
  isReply?: boolean;
}

export function ChatMessage({ message, onReply, isReply }: ChatMessageProps) {
  const isSystem = message.sender === 'system';
  const isAgent = message.sender === 'agent';

  // Split content by newlines for paragraph rendering
  const paragraphs = message.content.split('\n').filter(Boolean);

  return (
    <div
      className={cn(
        'mb-4 relative group/msg animate-[msg-in_200ms_ease]',
        isSystem && 'mb-2.5',
        isReply && 'border-l-2 border-l-[#6d5aed] pl-2 ml-8',
      )}
    >
      {/* Header: avatar + name + time + reply button */}
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar sender={message.sender} />
        <SenderName sender={message.sender} />
        <span className="text-[10px] text-[#64748b] font-mono">
          {message.timestamp}
        </span>
        {isAgent && onReply && (
          <button
            className="ml-auto bg-transparent border-none text-[#64748b] text-[10px] cursor-pointer opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150 px-1.5 py-0.5 rounded-[3px] hover:text-[#6d5aed] hover:bg-[#ffffff08]"
            onClick={() => onReply(message.id)}
          >
            Reply
          </button>
        )}
      </div>

      {/* Body */}
      <div
        className={cn(
          'pl-8 leading-relaxed',
          isSystem
            ? 'text-[#64748b] text-xs italic'
            : 'text-txt text-[13px]',
        )}
      >
        {paragraphs.map((p, i) => (
          <p key={i} className={cn('mb-2 last:mb-0', i === 0 && 'mt-0')}>
            {renderContent(p)}
          </p>
        ))}
      </div>

      {/* Structured card (if present) */}
      {message.card && (
        <div className="pl-8">
          <StructuredCard card={message.card} />
        </div>
      )}
    </div>
  );
}
