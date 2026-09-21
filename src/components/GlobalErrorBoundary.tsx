
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { errorService, ErrorSeverity } from '../services/errorService';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * PRODUCTION-GRADE GLOBAL ERROR BOUNDARY
 * Catches rendering errors and provides a recovery UI.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    errorService.handleError(error, {
      module: 'ComponentBoundary',
      severity: ErrorSeverity.CRITICAL,
      silent: false
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto">
              <AlertCircle size={32} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-50">Rendering Issue Encountered</h1>
              <p className="text-zinc-400 text-xs sm:text-sm">
                The application intercepted a view error. You can refresh or return to home.
              </p>
            </div>

            {this.state.error && (
              <div className="bg-black/60 p-3 rounded-xl text-left overflow-auto max-h-48 border border-zinc-800 space-y-2">
                <code className="text-xs text-red-400 font-mono block break-words">
                  {this.state.error.name}: {this.state.error.message}
                </code>
                {this.state.errorInfo?.componentStack && (
                  <details className="text-[10px] text-zinc-500 font-mono">
                    <summary className="cursor-pointer text-zinc-400 hover:text-zinc-300">View Component Stack</summary>
                    <pre className="mt-1 whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={this.handleReset}
                className="w-full h-11 bg-zinc-50 text-zinc-900 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors"
              >
                <RotateCcw size={16} />
                Refresh Application
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="w-full h-11 bg-zinc-800 text-zinc-300 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-zinc-700 transition-colors"
              >
                <Home size={16} />
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
