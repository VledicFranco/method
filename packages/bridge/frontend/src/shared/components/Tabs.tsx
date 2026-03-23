import { cn } from '@/shared/lib/cn';

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div
      className={cn('flex gap-1 border-b border-bdr', className)}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bio focus-visible:ring-offset-2 focus-visible:ring-offset-void',
              isActive
                ? 'text-bio'
                : 'text-txt-dim hover:text-txt',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.65rem] font-semibold',
                  isActive
                    ? 'bg-bio-dim text-bio'
                    : 'bg-txt-muted/10 text-txt-dim',
                )}
              >
                {tab.count}
              </span>
            )}
            {/* Bioluminescent underline */}
            {isActive && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-3/4 -translate-x-1/2 rounded-full bg-bio" />
            )}
          </button>
        );
      })}
    </div>
  );
}
