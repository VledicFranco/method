import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import {
  LayoutDashboard,
  Terminal,
  GitBranch,
  Zap,
  Shield,
  BarChart3,
  BookOpen,
  Search,
  Bell,
  Settings,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Terminal,
  GitBranch,
  Zap,
  Shield,
  BarChart3,
  BookOpen,
};

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  badge?: number;
}

export interface NavBarProps {
  items: NavItem[];
  onSearchClick?: () => void;
  notificationCount?: number;
  className?: string;
}

export function NavBar({ items, onSearchClick, notificationCount = 0, className }: NavBarProps) {
  const location = useLocation();

  function isActive(path: string): boolean {
    if (path === '/app/') {
      return location.pathname === '/app/' || location.pathname === '/app';
    }
    return location.pathname.startsWith(path);
  }

  return (
    <nav
      className={cn(
        'sticky top-0 z-40 flex h-14 items-center border-b border-bdr bg-void/95 backdrop-blur-sm px-sp-4',
        className,
      )}
    >
      {/* Logo */}
      <Link to="/app/" className="flex items-center gap-2 mr-sp-8">
        <div className="h-7 w-7 rounded-lg bg-bio/20 flex items-center justify-center">
          <span className="text-bio font-display font-bold text-sm">M</span>
        </div>
        <span className="font-display font-semibold text-txt text-sm tracking-tight hidden sm:block">
          Method Bridge
        </span>
      </Link>

      {/* Nav items */}
      <div className="flex items-center gap-1">
        {items.map((item) => {
          const Icon = ICON_MAP[item.icon];
          const active = isActive(item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bio focus-visible:ring-offset-2 focus-visible:ring-offset-void',
                active
                  ? 'text-bio'
                  : 'text-txt-dim hover:text-txt hover:bg-abyss-light',
              )}
            >
              {Icon && <Icon className="h-4 w-4" />}
              <span className="hidden md:inline">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-bio-dim px-1 text-[0.6rem] font-semibold text-bio">
                  {item.badge}
                </span>
              )}
              {/* Active underline */}
              {active && (
                <span className="absolute -bottom-[9px] left-1/2 h-0.5 w-3/4 -translate-x-1/2 rounded-full bg-bio" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right-side actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onSearchClick}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-solar px-1 text-[0.55rem] font-bold text-void">
              {notificationCount}
            </span>
          )}
        </button>

        <Link
          to="/app/settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>
    </nav>
  );
}
