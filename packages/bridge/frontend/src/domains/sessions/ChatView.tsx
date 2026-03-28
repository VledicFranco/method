/**
 * ChatView — renders a list of ChatTurn items for a session.
 * Supports historical, live, and pending turn kinds.
 * Auto-scrolls to bottom when turns change.
 *
 * Renders turn output as markdown with syntax-highlighted code blocks.
 */

import React, { useRef, useEffect, useState, useCallback, Component, type ComponentType, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Register only common languages for agent output
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';

SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('md', markdown);
import type { ChatTurn, SessionSummary } from './types';

export interface ChatViewProps {
  session: SessionSummary;
  turns: ChatTurn[];
  isWorking: boolean;
  isLoadingTranscript?: boolean;
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
  @keyframes skeleton-shimmer {
    0% { opacity: 0.3; }
    50% { opacity: 0.6; }
    100% { opacity: 0.3; }
  }
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

/* ------------------------------------------------------------------ */
/*  GlyphJS integration — renders ui: fenced code blocks              */
/* ------------------------------------------------------------------ */

const BRIDGE_GLYPH_THEME = {
  name: 'bridge-dark',
  variables: {
    '--glyph-bg': 'transparent',
    '--glyph-text': 'var(--text)',
    '--glyph-text-muted': 'var(--text-muted)',
    '--glyph-heading': 'var(--text)',
    '--glyph-link': 'var(--bio)',
    '--glyph-link-hover': 'var(--bio)',
    '--glyph-border': 'rgba(138,155,176,0.15)',
    '--glyph-border-strong': 'rgba(138,155,176,0.3)',
    '--glyph-surface': 'var(--abyss)',
    '--glyph-surface-raised': 'var(--abyss-light, #1a2433)',
    '--glyph-accent': 'var(--bio)',
    '--glyph-accent-hover': 'var(--bio)',
    '--glyph-accent-subtle': 'rgba(100,200,150,0.12)',
    '--glyph-accent-muted': 'rgba(100,200,150,0.08)',
    '--glyph-text-on-accent': 'var(--void)',
    '--glyph-code-bg': 'var(--abyss-light, #1a2433)',
    '--glyph-code-text': 'var(--text)',
    '--glyph-font-body': 'var(--font-mono)',
    '--glyph-font-heading': 'var(--font-mono)',
    '--glyph-font-mono': 'var(--font-mono)',
    '--glyph-color-success': 'var(--bio)',
    '--glyph-color-warning': 'var(--solar)',
    '--glyph-color-error': 'var(--error)',
    '--glyph-color-info': 'var(--bio)',
  } as Record<string, string>,
};

let _glyphPromise: Promise<{
  compile: (md: string) => any;
  GlyphDoc: ComponentType<{ ir: any }>;
}> | null = null;

function getGlyphRuntime() {
  if (!_glyphPromise) {
    _glyphPromise = Promise.all([
      import('@glyphjs/compiler'),
      import('@glyphjs/runtime'),
      import('@glyphjs/components'),
    ]).then(([compiler, runtime, components]) => {
      const rt = runtime.createGlyphRuntime({
        components: [...components.allComponentDefinitions] as any,
        theme: BRIDGE_GLYPH_THEME,
        animation: { enabled: true, duration: 200 },
      });
      return {
        compile: compiler.compile,
        GlyphDoc: rt.GlyphDocument as ComponentType<{ ir: any }>,
      };
    });
  }
  return _glyphPromise;
}

/** Mini error boundary that catches GlyphJS render failures */
class GlyphErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function GlyphBlock({ language, content }: { language: string; content: string }) {
  const [glyphResult, setGlyphResult] = useState<{ ir: any } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGlyphRuntime()
      .then(({ compile }) => {
        if (cancelled) return;
        const markdown = '```' + language + '\n' + content + '\n```';
        const result = compile(markdown);
        if (result && !result.hasErrors && result.ir) {
          setGlyphResult({ ir: result.ir });
        } else {
          setError(true);
        }
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [language, content]);

  const fallbackBlock = (
    <div style={codeBlockContainerStyle}>
      <div style={codeHeaderStyle}>
        <span>{language}</span>
      </div>
      <pre style={{ margin: 0, padding: '12px', fontSize: '12px', lineHeight: 1.5, color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
        {content}
      </pre>
    </div>
  );

  if (error) return fallbackBlock;

  if (!glyphResult) {
    return (
      <div style={{ ...codeBlockContainerStyle, padding: '12px', textAlign: 'center' as const }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
          loading {language}...
        </span>
      </div>
    );
  }

  return <LazyGlyphDocument ir={glyphResult.ir} fallback={fallbackBlock} />;
}

function LazyGlyphDocument({ ir, fallback }: { ir: any; fallback: ReactNode }) {
  const [GlyphDoc, setGlyphDoc] = useState<ComponentType<{ ir: any }> | null>(null);

  useEffect(() => {
    getGlyphRuntime().then(({ GlyphDoc: Doc }) => setGlyphDoc(() => Doc));
  }, []);

  if (!GlyphDoc) return null;

  return (
    <GlyphErrorBoundary fallback={fallback}>
      <div style={{ margin: '8px 0', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(138,155,176,0.1)' }}>
        <GlyphDoc ir={ir} />
      </div>
    </GlyphErrorBoundary>
  );
}

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
        remarkPlugins={[remarkGfm]}
        components={{
          code(props: any) {
            const { children, className, node, ...rest } = props;
            const match = /language-([\w:.]+)/.exec(className || '');
            const codeStr = String(children).replace(/\n$/, '');
            const isBlock = !!match || codeStr.includes('\n');

            // Route ui: blocks to GlyphJS
            if (match && match[1].startsWith('ui:')) {
              return <GlyphBlock language={match[1]} content={codeStr} />;
            }

            if (isBlock) {
              const lang = match ? match[1] : 'text';
              return (
                <div style={codeBlockContainerStyle}>
                  <div style={codeHeaderStyle}>
                    <span>{lang}</span>
                    <CopyButton text={codeStr} />
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={lang}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      padding: '12px',
                      background: 'transparent',
                      fontSize: '12px',
                      lineHeight: 1.5,
                    }}
                    codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
                  >
                    {codeStr}
                  </SyntaxHighlighter>
                </div>
              );
            }

            return (
              <code style={inlineCodeStyle} className={className} {...rest}>
                {children}
              </code>
            );
          },
          pre(props: any) {
            return <>{props.children}</>;
          },
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
/*  Memoized turn components                                          */
/* ------------------------------------------------------------------ */

const HistoricalTurn = React.memo(function HistoricalTurn({ turn }: { turn: Extract<ChatTurn, { kind: 'historical' }> }) {
  return (
    <div style={styles.turnBlock}>
      <div style={styles.promptHeader}>
        <span>&#x25B8;</span>
        <span style={styles.promptText}>{turn.prompt}</span>
      </div>
      <div style={styles.outputBlock}>
        <MarkdownOutput content={turn.output} />
      </div>
    </div>
  );
});

const LiveTurn = React.memo(function LiveTurn({ turn }: { turn: Extract<ChatTurn, { kind: 'live' }> }) {
  const m = turn.metadata;
  return (
    <div style={styles.turnBlock}>
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
});

function PendingTurnBlock({ turn }: { turn: Extract<ChatTurn, { kind: 'pending' }> }) {
  return (
    <div style={styles.turnBlock}>
      <div style={styles.promptHeader}>
        <span>&#x25B8;</span>
        <span style={styles.promptText}>{turn.prompt}</span>
      </div>
      <PendingDots />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton screen for transcript loading                            */
/* ------------------------------------------------------------------ */

function ChatSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} style={styles.turnBlock}>
          <div style={{ ...styles.promptHeader, width: `${120 + i * 40}px`, height: '12px', background: 'var(--abyss-light, #1a2433)', borderRadius: '4px', animation: 'skeleton-shimmer 1.5s ease-in-out infinite' }} />
          <div style={{ ...styles.outputBlock, minHeight: `${60 + i * 20}px`, background: 'var(--abyss)', opacity: 0.5 }}>
            <div style={{ height: '10px', width: '80%', background: 'var(--abyss-light, #1a2433)', borderRadius: '4px', marginBottom: '8px', animation: 'skeleton-shimmer 1.5s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
            <div style={{ height: '10px', width: '60%', background: 'var(--abyss-light, #1a2433)', borderRadius: '4px', animation: 'skeleton-shimmer 1.5s ease-in-out infinite', animationDelay: `${i * 0.2 + 0.1}s` }} />
          </div>
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ChatView                                                          */
/* ------------------------------------------------------------------ */

export function ChatView({ session, turns, isWorking, isLoadingTranscript }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, isWorking]);

  return (
    <div style={styles.container}>
      {/* Inject markdown styles once */}
      <style>{markdownCSS}</style>

      {/* Skeleton when loading transcript */}
      {isLoadingTranscript && turns.length === 0 && <ChatSkeleton />}

      {turns.map((turn, i) => {
        if (turn.kind === 'historical') return <HistoricalTurn key={i} turn={turn} />;
        if (turn.kind === 'live') return <LiveTurn key={i} turn={turn} />;
        if (turn.kind === 'pending') return <PendingTurnBlock key={i} turn={turn} />;
        return null;
      })}

      {/* Spawn-in-progress notice (no turns yet, session is working) */}
      {turns.length === 0 && (session.status === 'working' || isWorking) && (
        <div style={styles.turnBlock}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-muted)',
            }}
          >
            <PendingDots />
            <span>Session initializing...</span>
          </div>
        </div>
      )}

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
