import { type ReactNode, useEffect, useCallback } from 'react';
import { cn } from '@/shared/lib/cn';
import { X } from 'lucide-react';

export interface SlideOverPanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function SlideOverPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  className,
}: SlideOverPanelProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-void/60 backdrop-blur-sm animate-backdrop-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 flex h-full w-slideover flex-col bg-abyss border-l border-bdr shadow-2xl animate-slide-over-in',
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Detail panel'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bdr px-sp-5 py-sp-4">
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-md text-txt font-semibold truncate">{title}</h2>
            )}
            {subtitle && (
              <p className="text-xs text-txt-dim truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-sp-5">
          {children}
        </div>
      </div>
    </>
  );
}
