/**
 * ConversationPanel — Right panel for human-agent gate conversations.
 *
 * Tabbed by build (one tab per build with conversation data).
 * Tab indicators: amber pulsing for waiting, green for done, blue for running.
 * Scrollable message list with auto-scroll on new messages.
 * Input area at bottom: skill buttons, reply context, textarea, gate action buttons.
 *
 * @see PRD 047 §Dashboard Architecture — Conversation Panel
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { ChatMessage } from './ChatMessage';
import { GateActions } from './GateActions';
import { SkillButtons } from './SkillButtons';
import { MessageThread } from './MessageThread';
import type { ReplyContext } from './MessageThread';
import type { BuildSummary, ConversationMessage, SkillType } from './types';

// ── Tab dot color ──

function tabDotClass(build: BuildSummary): string {
  if (build.status === 'completed') return 'bg-[#10b981]';
  if (build.status === 'waiting') return 'bg-[#f59e0b] animate-[pulse-dot_1.5s_infinite]';
  return 'bg-[#3b82f6]';
}

// ── Tab label ──

function tabLabel(build: BuildSummary): string {
  if (build.status === 'completed') return build.name;
  const phaseName = build.currentPhase.charAt(0).toUpperCase() + build.currentPhase.slice(1);
  return `${phaseName} (${build.name})`;
}

// ── Main Export ──

export interface ConversationPanelProps {
  /** All builds (to render tabs) */
  builds: BuildSummary[];
  /** Currently selected build ID */
  selectedBuildId: string | null;
  /** Called when a conversation tab is clicked */
  onSelectBuild: (id: string) => void;
}

export function ConversationPanel({
  builds,
  selectedBuildId,
  onSelectBuild,
}: ConversationPanelProps) {
  const [inputText, setInputText] = useState('');
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);
  const [localMessages, setLocalMessages] = useState<Record<string, ConversationMessage[]>>({});
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Current build
  const selectedBuild = useMemo(
    () => builds.find((b) => b.id === selectedBuildId) ?? null,
    [builds, selectedBuildId],
  );

  // Merge mock conversation with any locally-added messages
  const messages = useMemo(() => {
    if (!selectedBuild) return [];
    const base = selectedBuild.conversation ?? [];
    const local = localMessages[selectedBuild.id] ?? [];
    return [...base, ...local];
  }, [selectedBuild, localMessages]);

  // Builds that have conversation data (for tabs)
  const conversationBuilds = useMemo(
    () => builds.filter((b) => (b.conversation && b.conversation.length > 0) || (localMessages[b.id] && localMessages[b.id].length > 0)),
    [builds, localMessages],
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Handlers ──

  const addLocalMessage = useCallback(
    (buildId: string, msg: ConversationMessage) => {
      setLocalMessages((prev) => ({
        ...prev,
        [buildId]: [...(prev[buildId] ?? []), msg],
      }));
    },
    [],
  );

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !selectedBuild) return;

    const msg: ConversationMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'human',
      content: inputText.trim(),
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      replyTo: replyContext?.messageId,
    };

    addLocalMessage(selectedBuild.id, msg);
    setInputText('');
    setReplyContext(null);
    inputRef.current?.focus();
  }, [inputText, selectedBuild, replyContext, addLocalMessage]);

  const handleReply = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;

      setReplyContext({
        messageId,
        preview: msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content,
      });
      inputRef.current?.focus();
    },
    [messages],
  );

  const handleGateAction = useCallback(
    (action: string) => {
      if (!selectedBuild) return;

      // Mock: add a system message indicating the action
      const msg: ConversationMessage = {
        id: `action-${Date.now()}`,
        sender: 'system',
        content: `Gate action: ${action}`,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };
      addLocalMessage(selectedBuild.id, msg);
    },
    [selectedBuild, addLocalMessage],
  );

  const handleSkill = useCallback(
    (skill: SkillType) => {
      if (!selectedBuild) return;

      const msg: ConversationMessage = {
        id: `skill-${Date.now()}`,
        sender: 'system',
        content: `Skill invoked: ${skill}`,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };
      addLocalMessage(selectedBuild.id, msg);
    },
    [selectedBuild, addLocalMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ── Render ──

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Conversation tabs */}
      <div className="flex border-b border-bdr overflow-x-auto px-1 shrink-0 scrollbar-none">
        {conversationBuilds.map((build) => (
          <button
            key={build.id}
            onClick={() => onSelectBuild(build.id)}
            className={cn(
              'px-3.5 py-2.5 text-[11px] text-txt-dim cursor-pointer whitespace-nowrap transition-all duration-150',
              'bg-transparent border-none border-b-2 border-b-transparent',
              build.id === selectedBuildId && 'text-txt border-b-[#6d5aed]',
              build.id !== selectedBuildId && 'hover:text-txt',
            )}
          >
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle',
                tabDotClass(build),
              )}
            />
            {tabLabel(build)}
          </button>
        ))}
        {conversationBuilds.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-[#64748b]">
            No active conversations
          </div>
        )}
      </div>

      {/* Message list */}
      <div
        ref={messagesRef}
        className="flex-1 overflow-y-auto p-4 min-h-0"
      >
        {selectedBuild && messages.length > 0 ? (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onReply={msg.sender === 'agent' ? handleReply : undefined}
              isReply={!!msg.replyTo}
            />
          ))
        ) : (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-[#64748b] text-3xl mb-3">&#9993;</div>
              <div className="text-[13px] text-txt-dim mb-1">No messages yet</div>
              <div className="text-[11px] text-[#64748b]">
                Conversation will appear when the build starts a gate.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-bdr p-3 shrink-0">
        {/* Skill buttons */}
        <SkillButtons onSkill={handleSkill} />

        {/* Reply context */}
        <MessageThread
          replyContext={replyContext}
          onCancel={() => setReplyContext(null)}
        />

        {/* Input + action buttons */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className={cn(
              'flex-1 bg-void border border-bdr text-txt text-[13px] px-3 py-2.5 resize-none outline-none min-h-[40px] max-h-[120px] transition-colors duration-150',
              replyContext
                ? 'rounded-none rounded-b-[5px] border-t-0'
                : 'rounded-[5px]',
              'focus:border-[#6d5aed]',
              'placeholder:text-[#ffffff22]',
            )}
          />

          <GateActions
            activeGate={selectedBuild?.activeGate}
            onAction={handleGateAction}
            onSend={handleSend}
            sendDisabled={!inputText.trim()}
          />
        </div>
      </div>
    </div>
  );
}
