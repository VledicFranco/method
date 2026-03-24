import { type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { NavBar } from './NavBar';
import { NAV_ITEMS } from '@/shared/lib/constants';

export interface PageShellProps {
  /** Page title for the header */
  title?: string;
  /** Expand content area to 1200px for DAG/analytics views */
  wide?: boolean;
  /** Optional right-side action elements in the header */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Full-screen mode: hides nav, removes padding, fills viewport. Used for mobile chat. */
  fullScreen?: boolean;
  /** Hide the navbar (e.g. for full-screen chat on mobile) */
  hideNav?: boolean;
}

export function PageShell({ title, wide = false, actions, children, className, fullScreen = false, hideNav = false }: PageShellProps) {
  if (fullScreen) {
    return (
      <div className="h-dvh flex flex-col bg-void overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void">
      <NavBar items={[...NAV_ITEMS]} hidden={hideNav} />
      <main
        className={cn(
          'mx-auto px-sp-4 py-sp-6',
          wide ? 'max-w-[1200px]' : 'max-w-[820px]',
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between mb-sp-6">
            <h1 className="font-display text-xl text-txt tracking-tight">{title}</h1>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
