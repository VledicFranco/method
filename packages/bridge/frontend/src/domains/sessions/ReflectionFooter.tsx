/**
 * ReflectionFooter — renders reflection lessons below the agent response.
 * Shown when cognitive-agent reflection data contains lessons.
 * PRD 033 C-4: Reflection footer for cognitive turns.
 */

import type React from 'react';

export interface ReflectionFooterProps {
  lessons: string[];
}

const styles = {
  container: {
    borderLeft: '4px solid #7c3aed',
    background: 'rgba(124, 58, 237, 0.06)',
    borderRadius: '0 6px 6px 0',
    padding: '8px 12px',
    marginTop: '4px',
  } as React.CSSProperties,
  heading: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    color: '#7c3aed',
    marginBottom: '6px',
  } as React.CSSProperties,
  list: {
    margin: 0,
    paddingLeft: '16px',
    listStyle: 'disc',
  } as React.CSSProperties,
  item: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    marginBottom: '2px',
  } as React.CSSProperties,
};

export function ReflectionFooter({ lessons }: ReflectionFooterProps) {
  if (!lessons.length) return null;

  return (
    <div style={styles.container}>
      <div style={styles.heading}>{'\uD83D\uDCDD'} Reflection</div>
      <ul style={styles.list}>
        {lessons.map((lesson, i) => (
          <li key={`lesson-${i}-${lesson.slice(0, 20)}`} style={styles.item}>{lesson}</li>
        ))}
      </ul>
    </div>
  );
}
