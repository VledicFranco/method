import { lazy, Suspense, Component, type ReactNode, type ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GenesisFAB } from './domains/genesis/GenesisFAB';
import { GenesisChatPanel } from './domains/genesis/GenesisChatPanel';
import { GenesisStatusPoller } from './domains/genesis/GenesisStatusPoller';
import { GenesisActionHandler } from './domains/genesis/GenesisActionHandler';

// Lazy-loaded pages for code splitting
const Dashboard = lazy(() => import('./shared/pages/Dashboard'));
const Sessions = lazy(() => import('./domains/sessions/Sessions'));
const ProjectsPage = lazy(() => import('./domains/projects/ProjectsPage'));
const Strategies = lazy(() => import('./domains/strategies/Strategies'));
const StrategyDetail = lazy(() => import('./domains/strategies/StrategyDetail'));
const Triggers = lazy(() => import('./domains/triggers/Triggers'));
const Governance = lazy(() => import('./shared/pages/Governance'));
const Analytics = lazy(() => import('./domains/tokens/Analytics'));
const Registry = lazy(() => import('./domains/registry/Registry'));
const Settings = lazy(() => import('./shared/pages/Settings'));
const ExecutionView = lazy(() => import('./domains/strategies/ExecutionView'));
const ExperimentList = lazy(() => import('./domains/experiments/ExperimentList'));
const ExperimentDetail = lazy(() => import('./domains/experiments/ExperimentDetail'));
const RunDetail = lazy(() => import('./domains/experiments/RunDetail'));

// Preload functions for route chunks — trigger on nav hover to eliminate load delay
export const ROUTE_PRELOADS: Record<string, () => void> = {
  '/': () => { import('./shared/pages/Dashboard'); },
  '/sessions': () => { import('./domains/sessions/Sessions'); },
  '/projects': () => { import('./domains/projects/ProjectsPage'); },
  '/strategies': () => { import('./domains/strategies/Strategies'); },
  '/governance': () => { import('./shared/pages/Governance'); },
  '/analytics': () => { import('./domains/tokens/Analytics'); },
  '/registry': () => { import('./domains/registry/Registry'); },
  '/settings': () => { import('./shared/pages/Settings'); },
  '/lab': () => { import('./domains/experiments/ExperimentList'); },
};

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
      <BrowserRouter basename="/app">
        <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sessions/:id?" element={<Sessions />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/pipelines" element={<Navigate to="/strategies" replace />} />
            <Route path="/strategies/:id" element={<StrategyDetail />} />
            <Route path="/strategies/:id/exec/:eid" element={<ExecutionView />} />
            <Route path="/triggers" element={<Navigate to="/strategies" replace />} />
            <Route path="/triggers/:id" element={<Navigate to="/strategies" replace />} />
            <Route path="/governance" element={<Governance />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/registry" element={<Registry />} />
            <Route path="/settings" element={<Settings />} />
            {/* PRD 041: Cognitive Experiment Lab */}
            <Route path="/lab" element={<ExperimentList />} />
            <Route path="/lab/:id" element={<ExperimentDetail />} />
            <Route path="/lab/:id/run/:runId" element={<RunDetail />} />
            {/* Catch-all: redirect to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        {/* Universal Genesis — always present across all pages (PRD 025) */}
        <GenesisStatusPoller />
        <GenesisActionHandler />
        <GenesisFAB />
        <GenesisChatPanel />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
