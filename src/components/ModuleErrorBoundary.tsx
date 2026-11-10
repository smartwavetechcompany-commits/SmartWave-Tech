import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Route-level Error Boundary
 * Keeps the application shell (Sidebar, TopBar, Auth) mounted and responsive
 * even if a specific module encounters a view error.
 */
export class ModuleErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ModuleErrorBoundary] Caught module rendering issue:', error?.message || error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-6 sm:p-12 flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center">
            <AlertCircle size={28} />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-lg font-bold text-zinc-100">Module View Temporarily Intercepted</h2>
            <p className="text-xs text-zinc-400">
              The selected module encountered an unexpected view state. You can reload this view or navigate to another module using the sidebar without refreshing the page.
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-lg shadow-emerald-950/20"
          >
            <RotateCcw size={14} />
            Reload Module View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
