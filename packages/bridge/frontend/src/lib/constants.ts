/** Route path constants */
export const ROUTES = {
  DASHBOARD: '/app/',
  SESSIONS: '/app/sessions',
  SESSION_DETAIL: '/app/sessions/:id',
  STRATEGIES: '/app/strategies',
  STRATEGY_DETAIL: '/app/strategies/:id',
  TRIGGERS: '/app/triggers',
  TRIGGER_DETAIL: '/app/triggers/:id',
  GOVERNANCE: '/app/governance',
  ANALYTICS: '/app/analytics',
  REGISTRY: '/app/registry',
  SETTINGS: '/app/settings',
} as const;

/** Status → color token mapping */
export const STATUS_COLORS = {
  running: { text: 'text-bio', bg: 'bg-bio-dim', border: 'border-bio' },
  completed: { text: 'text-cyan', bg: 'bg-cyan/15', border: 'border-cyan' },
  failed: { text: 'text-error', bg: 'bg-error-dim', border: 'border-error' },
  pending: { text: 'text-txt-dim', bg: 'bg-txt-muted/10', border: 'border-bdr' },
  queued: { text: 'text-txt-dim', bg: 'bg-txt-muted/10', border: 'border-bdr' },
  suspended: { text: 'text-nebular', bg: 'bg-nebular-dim', border: 'border-nebular' },
  warning: { text: 'text-solar', bg: 'bg-solar-dim', border: 'border-solar' },
  dead: { text: 'text-txt-muted', bg: 'bg-txt-muted/5', border: 'border-bdr' },
} as const;

export type SessionStatus = keyof typeof STATUS_COLORS;

/** Event type → timeline color mapping */
export const EVENT_COLORS = {
  session: 'bg-bio',
  trigger_fired: 'bg-solar',
  completed: 'bg-cyan',
  governance: 'bg-nebular',
  error: 'bg-error',
  gate_passed: 'bg-bio',
  escalation: 'bg-solar',
} as const;

/** Navigation items */
export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/app/', icon: 'LayoutDashboard' },
  { label: 'Sessions', path: '/app/sessions', icon: 'Terminal' },
  { label: 'Strategies', path: '/app/strategies', icon: 'GitBranch' },
  { label: 'Triggers', path: '/app/triggers', icon: 'Zap' },
  { label: 'Governance', path: '/app/governance', icon: 'Shield' },
  { label: 'Analytics', path: '/app/analytics', icon: 'BarChart3' },
] as const;
