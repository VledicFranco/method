import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { useIsMobile } from '@/shared/layout/useIsMobile';
import { StatusBar, type BreadcrumbSegment } from './StatusBar';
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
  Menu,
  X,
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
  /** Breadcrumb segments for contextual navigation */
  breadcrumbs?: BreadcrumbSegment[];
  onSearchClick?: () => void;
  notificationCount?: number;
  className?: string;
}

export function NavBar({ items, breadcrumbs = [], onSearchClick, notificationCount = 0, className }: NavBarProps) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function isActive(path: string): boolean {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  }

  return (
    <>
      <nav
        className={cn(
          'sticky top-0 z-40 flex h-14 items-center border-b border-bdr bg-void/95 backdrop-blur-sm px-sp-4',
          className,
        )}
      >
        {/* Mobile: Logo + breadcrumb + hamburger */}
        {isMobile ? (
          <>
            <Link to="/" className="flex items-center shrink-0">
              <div className="h-7 w-7 rounded-lg bg-bio/20 flex items-center justify-center">
                <span className="text-bio font-display font-bold text-sm">M</span>
              </div>
            </Link>

            {/* Breadcrumb fills the middle on mobile */}
            <StatusBar segments={breadcrumbs} inline />

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors shrink-0"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </>
        ) : (
          /* Desktop: Logo | centered nav | right actions */
          <>
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <div className="h-7 w-7 rounded-lg bg-bio/20 flex items-center justify-center">
                <span className="text-bio font-display font-bold text-sm">M</span>
              </div>
            </Link>

            {/* Centered nav items — flex-1 with justify-center */}
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-1">
                {items.map((item) => {
                  const Icon = ICON_MAP[item.icon];
                  const active = isActive(item.path);

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        'relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 cursor-pointer',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bio focus-visible:ring-offset-2 focus-visible:ring-offset-void',
                        active
                          ? 'text-bio'
                          : 'text-txt-dim hover:text-txt hover:bg-abyss-light',
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      <span className="hidden lg:inline">{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-bio-dim px-1 text-[0.6rem] font-semibold text-bio">
                          {item.badge}
                        </span>
                      )}
                      {active && (
                        <span className="absolute -bottom-[9px] left-1/2 h-0.5 w-3/4 -translate-x-1/2 rounded-full bg-bio" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right-side actions */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onSearchClick}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors cursor-pointer"
                aria-label="Search"
              >
                <Search className="h-4 w-4" />
              </button>

              <button
                className="relative flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors cursor-pointer"
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
                to="/settings"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
                aria-label="Settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </>
        )}
      </nav>

      {/* Desktop breadcrumb bar (below nav) */}
      {!isMobile && breadcrumbs.length > 0 && (
        <StatusBar segments={breadcrumbs} />
      )}

      {/* Mobile dropdown menu */}
      {isMobile && mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-void/60"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed top-14 left-0 right-0 z-[35] bg-abyss border-b border-bdr shadow-lg animate-slide-down">
            <div className="py-2 px-sp-4">
              {items.map((item) => {
                const Icon = ICON_MAP[item.icon];
                const active = isActive(item.path);

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                      active
                        ? 'text-bio bg-bio-dim'
                        : 'text-txt-dim hover:text-txt hover:bg-abyss-light',
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4" />}
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <div className="border-t border-bdr mt-2 pt-2">
                <Link
                  to="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors cursor-pointer"
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
