import { type ReactNode, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/shared/components/Button';

export interface AttentionItem {
  id: string;
  icon?: ReactNode;
  description: string;
  actionLabel: string;
  onAction: () => void;
  priority?: 'high' | 'medium' | 'low';
}

export interface AttentionBannerProps {
  items: AttentionItem[];
  onDismiss?: (id: string) => void;
  className?: string;
}

export function AttentionBanner({ items, onDismiss, className }: AttentionBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        'rounded-card border border-bdr border-l-2 border-l-solar bg-abyss animate-slide-down overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-sp-5 py-sp-3 text-left"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-solar" />
          <span className="text-sm font-medium text-solar">
            {items.length} item{items.length !== 1 ? 's' : ''} need{items.length === 1 ? 's' : ''} your attention
          </span>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-txt-dim" />
        ) : (
          <ChevronUp className="h-4 w-4 text-txt-dim" />
        )}
      </button>

      {/* Items */}
      {!collapsed && (
        <div className="border-t border-bdr px-sp-5 py-sp-3 space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                {item.icon && <span className="shrink-0 text-solar">{item.icon}</span>}
                <span className="text-sm text-txt truncate">{item.description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={item.onAction}
                >
                  {item.actionLabel}
                </Button>
                {onDismiss && item.priority !== 'high' && (
                  <button
                    onClick={() => onDismiss(item.id)}
                    className="text-xs text-txt-muted hover:text-txt-dim transition-colors"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
