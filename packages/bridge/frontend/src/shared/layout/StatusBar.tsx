/**
 * Contextual status/breadcrumb bar.
 *
 * Desktop: renders below nav bar as a subtle breadcrumb trail.
 * Mobile: renders INSIDE the nav bar, filling the space between logo and hamburger.
 *
 * Horizontal scrollable on mobile — no visible scrollbar.
 * Pages pass breadcrumb segments via PageShell.
 */

import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';

export interface BreadcrumbSegment {
  label: string;
  path?: string; // If provided, segment is a link
}

export interface StatusBarProps {
  segments: BreadcrumbSegment[];
  /** Render inline (inside nav bar on mobile) vs standalone bar */
  inline?: boolean;
  className?: string;
}

export function StatusBar({ segments, inline = false, className }: StatusBarProps) {
  if (segments.length === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs font-medium overflow-x-auto',
        // Hide scrollbar but allow horizontal swipe
        'scrollbar-none',
        inline
          ? 'flex-1 min-w-0 mx-3'
          : 'px-sp-4 py-sp-2 border-b border-bdr bg-void/50',
        className,
      )}
    >
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1 shrink-0">
          {i > 0 && <ChevronRight className="h-3 w-3 text-txt-muted shrink-0" />}
          {seg.path ? (
            <Link
              to={seg.path}
              className="text-txt-dim hover:text-txt transition-colors whitespace-nowrap"
            >
              {seg.label}
            </Link>
          ) : (
            <span className="text-txt whitespace-nowrap">{seg.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
