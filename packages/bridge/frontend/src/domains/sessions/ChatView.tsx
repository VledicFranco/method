/**
 * ChatView — renders a list of ChatTurn items for a session.
 * Supports historical, live, and pending turn kinds.
 * Auto-scrolls to bottom when turns change.
 *
 * Renders turn output as markdown with syntax-highlighted code blocks.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatTurn, SessionSummary } from './types';

export interface ChatViewProps {
  session: SessionSummary;
  turns: ChatTurn[];
  isWorking: boolean;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = {
  container: {
    flex: 1,
    overflowY: 'auto' as const,
    background: 'var(--void)',
    backgroundImage:
      'radial-gradient(circle, rgba(138,155,176,0.08) 1px, transparent 1px)',
    backgroundSize: '20px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '16px',
    gap: '16px',
  },
  turnBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  promptHeader: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--bio)',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  promptText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--bio)',
    opacity: 0.9,
  },
  outputBlock: {
    background: 'var(--abyss)',
    borderLeft: '3px solid var(--bio)',
    borderRadius: '0 6px 6px 0',
    padding: '10px 12px',
    fontSize: '13px',
    color: 'var(--text)',
    lineHeight: 1.7,
    wordBreak: 'break-word' as const,
  },
  chipsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap' as const,
    marginTop: '4px',
  },
  chip: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--text-muted)',
    background: 'var(--abyss-light, #1a2433)',
    border: '1px solid rgba(138,155,176,0.15)',
    borderRadius: '10px',
    padding: '2px 8px',
    letterSpacing: '0.02em',
  },
  pendingDots: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 12px',
  },
  terminatedNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: 'var(--error-dim)',
    border: '1px solid var(--error)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--error)',
    marginTop: '4px',
  },
  scrollAnchor: {
    height: '1px',
    flexShrink: 0,
  },
};

/* ------------------------------------------------------------------ */
/*  Markdown styles (injected once via <style>)                       */
/* ------------------------------------------------------------------ */

const markdownCSS = `
  .chat-markdown p { margin: 0 0 8px 0; }
  .chat-markdown p:last-child { margin-bottom: 0; }
  .chat-markdown ul, .chat-markdown ol { margin: 4px 0 8px 0; padding-left: 20px; }
  .chat-markdown li { margin: 2px 0; }
  .chat-markdown li > p { margin: 0; }
  .chat-markdown strong { color: var(--text); font-weight: 600; }
  .chat-markdown em { color: var(--text-muted); }
  .chat-markdown h1, .chat-markdown h2, .chat-markdown h3,
  .chat-markdown h4, .chat-markdown h5, .chat-markdown h6 {
    margin: 12px 0 6px 0;
    color: var(--text);
    font-weight: 600;
    line-height: 1.3;
  }
  .chat-markdown h1 { font-size: 1.3em; }
  .chat-markdown h2 { font-size: 1.15em; }
  .chat-markdown h3 { font-size: 1.05em; }
  .chat-markdown blockquote {
    margin: 4px 0 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--bio);
    color: var(--text-muted);
    background: rgba(138,155,176,0.05);
    border-radius: 0 4px 4px 0;
  }
  .chat-markdown hr {
    border: none;
    border-top: 1px solid rgba(138,155,176,0.15);
    margin: 12px 0;
  }
  .chat-markdown a {
    color: var(--bio);
    text-decoration: underline;
    text-decoration-color: rgba(138,155,176,0.3);
  }
  .chat-markdown a:hover { text-decoration-color: var(--bio); }
  .chat-markdown table {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .chat-markdown th, .chat-markdown td {
    border: 1px solid rgba(138,155,176,0.15);
    padding: 4px 8px;
  }
  .chat-markdown th {
    background: var(--abyss-light, #1a2433);
    font-weight: 600;
  }
`;

/* ------------------------------------------------------------------ */
/*  Code block with copy button                                       */
/* ------------------------------------------------------------------ */

const codeBlockContainerStyle: React.CSSProperties = {
  position: 'relative',
  margin: '8px 0',
  borderRadius: '6px',
  overflow: 'hidden',
  background: 'var(--abyss-light, #1a2433)',
  border: '1px solid rgba(138,155,176,0.1)',
};

const codeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 12px',
  background: 'rgba(0,0,0,0.2)',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  color: 'var(--text-muted)',
};

const copyBtnBase: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(138,155,176,0.2)',
  borderRadius: '4px',
  padding: '2px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  transition: 'all 0.15s ease',
};

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9em',
  background: 'rgba(100,200,150,0.12)',
  color: 'var(--text)',
  padding: '1px 5px',
  borderRadius: '3px',
  border: '1px solid rgba(100,200,150,0.08)',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        ...copyBtnBase,
        color: copied ? 'var(--bio)' : 'var(--text-muted)',
        borderColor: copied ? 'var(--bio)' : 'rgba(138,155,176,0.2)',
      }}
      aria-label="Copy code"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

/**
 * Custom code component for ReactMarkdown.
 * Renders inline code with a tinted background, and fenced code blocks
 * with syntax highlighting + a copy button.
 */
function CodeBlock({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');

  // Determine if this is a block code element.
  // ReactMarkdown wraps fenced blocks in <pre><code>. When there's a language
  // className OR the content contains newlines, treat it as a block.
  const isBlock = !!match || codeString.includes('\n');

  if (isBlock) {
    const language = match ? match[1] : 'text';
    return (
      <div style={codeBlockContainerStyle}>
        <div style={codeHeaderStyle}>
          <span>{language}</span>
          <CopyButton text={codeString} />
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: '12px',
            background: 'transparent',
            fontSize: '12px',
            lineHeight: 1.5,
          }}
          codeTagProps={{
            style: { fontFamily: 'var(--font-mono)' },
          }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    );
  }

  // Inline code
  return (
    <code style={inlineCodeStyle} className={className} {...rest}>
      {children}
    </code>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown-rendered output                                          */
/* ------------------------------------------------------------------ */

function MarkdownOutput({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        components={{
          code: CodeBlock as any,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated pending dots                                             */
/* ------------------------------------------------------------------ */

function PendingDots() {
  return (
    <>
      <style>{`
        @keyframes dot-bounce {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .chat-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--solar);
          display: inline-block;
          animation: dot-bounce 1.4s ease-in-out infinite;
        }
        .chat-dot:nth-child(2) { animation-delay: 0.2s; }
        .chat-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <div style={styles.pendingDots} aria-label="Working...">
        <span className="chat-dot" />
        <span className="chat-dot" />
        <span className="chat-dot" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Format duration_ms to "Xs" */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format cache tokens to "Nk cached" */
function formatCached(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k cached`;
  return `${tokens} cached`;
}

/* ------------------------------------------------------------------ */
/*  ChatView                                                          */
/* ------------------------------------------------------------------ */

export function ChatView({ session, turns, isWorking }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, isWorking]);

  return (
    <div style={styles.container}>
      {/* Inject markdown styles once */}
      <style>{markdownCSS}</style>

      {turns.map((turn, i) => {
        if (turn.kind === 'historical') {
          return (
            <div key={i} style={styles.turnBlock}>
              <div style={styles.promptHeader}>
                <span>&#x25B8;</span>
                <span style={styles.promptText}>{turn.prompt}</span>
              </div>
              <div style={styles.outputBlock}>
                <MarkdownOutput content={turn.output} />
              </div>
            </div>
          );
        }

        if (turn.kind === 'live') {
          const m = turn.metadata;
          return (
            <div key={i} style={styles.turnBlock}>
              <div style={styles.promptHeader}>
                <span>&#x25B8;</span>
                <span style={styles.promptText}>{turn.prompt}</span>
              </div>
              <div style={styles.outputBlock}>
                <MarkdownOutput content={turn.output} />
              </div>
              <div style={styles.chipsRow}>
                <span style={styles.chip}>${m.cost_usd.toFixed(2)}</span>
                <span style={styles.chip}>{m.num_turns} turns</span>
                <span style={styles.chip}>{formatDuration(m.duration_ms)}</span>
                <span style={styles.chip}>{formatCached(m.cache_read_tokens)}</span>
                {m.stop_reason && (
                  <span style={styles.chip}>{m.stop_reason}</span>
                )}
              </div>
            </div>
          );
        }

        if (turn.kind === 'pending') {
          return (
            <div key={i} style={styles.turnBlock}>
              <div style={styles.promptHeader}>
                <span>&#x25B8;</span>
                <span style={styles.promptText}>{turn.prompt}</span>
              </div>
              <PendingDots />
            </div>
          );
        }

        return null;
      })}

      {/* Terminated notice */}
      {session.status === 'dead' && turns.length > 0 && (
        <div style={styles.terminatedNotice}>
          <span>&#x2297;</span>
          <span>session terminated</span>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} style={styles.scrollAnchor} />
    </div>
  );
}
