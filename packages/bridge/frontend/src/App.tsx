import { lazy, Suspense, Component, type ReactNode, type ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Lazy-loaded pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Sessions = lazy(() => import('./pages/Sessions'));
const Strategies = lazy(() => import('./pages/Strategies'));
const StrategyDetail = lazy(() => import('./pages/StrategyDetail'));
const Triggers = lazy(() => import('./pages/Triggers'));
const Governance = lazy(() => import('./pages/Governance'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Registry = lazy(() => import('./pages/Registry'));
const Settings = lazy(() => import('./pages/Settings'));

// ── Route loading skeleton ──

function RouteSkeleton() {
  return (
    <div className="min-h-screen bg-void">
      {/* Nav placeholder */}
      <div className="sticky top-0 z-40 flex h-14 items-center border-b border-bdr bg-void/95 px-4">
        <div className="h-7 w-7 rounded-lg bg-abyss-light animate-pulse" />
        <div className="ml-3 h-4 w-24 rounded bg-abyss-light animate-pulse" />
      </div>
      {/* Content placeholder */}
      <div className="mx-auto max-w-[820px] px-4 py-6">
        <div className="h-6 w-40 rounded bg-abyss-light animate-pulse mb-6" />
        <div className="h-64 rounded-xl bg-abyss-light/50 animate-pulse" />
      </div>
    </div>
  );
}

// ── Error Boundary ──

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-void flex items-center justify-center">
          <div className="max-w-md mx-auto text-center p-8">
            <div className="h-12 w-12 mx-auto mb-4 rounded-full bg-error-dim flex items-center justify-center">
              <span className="text-error text-xl">!</span>
            </div>
            <h1 className="font-display text-lg text-txt mb-2">Something went wrong</h1>
            <p className="text-sm text-txt-dim mb-6">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-bio text-void text-sm font-medium hover:bg-bio/90 transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ── App ──

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/app" element={<Dashboard />} />
            <Route path="/app/" element={<Dashboard />} />
            <Route path="/app/sessions" element={<Sessions />} />
            <Route path="/app/strategies" element={<Strategies />} />
            <Route path="/app/strategies/:id" element={<StrategyDetail />} />
            <Route path="/app/triggers" element={<Triggers />} />
            <Route path="/app/triggers/:id" element={<Triggers />} />
            <Route path="/app/governance" element={<Governance />} />
            <Route path="/app/analytics" element={<Analytics />} />
            <Route path="/app/registry" element={<Registry />} />
            <Route path="/app/settings" element={<Settings />} />
            {/* Catch-all: redirect to dashboard */}
            <Route path="/app/*" element={<Navigate to="/app/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
