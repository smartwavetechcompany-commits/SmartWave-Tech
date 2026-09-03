import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RefreshCw, XCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  folioId?: string;
  guestId?: string;
  onClose?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  transactionId?: string;
}

export class LedgerAuditErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    transactionId: 'none'
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Ledger Audit Crash', {
      folioId: this.props.folioId || 'unknown',
      guestId: this.props.guestId || 'unknown',
      transactionId: this.state.transactionId || 'none',
      error: error?.message || String(error),
      stack: error?.stack,
      componentStack: errorInfo?.componentStack
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onClose) {
      this.props.onClose();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-red-500/40 rounded-2xl w-full max-w-xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <ShieldAlert className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Ledger Audit Error Detected</h3>
                <p className="text-xs text-zinc-400">
                  The ledger audit modal encountered an unexpected rendering error and was safely contained.
                </p>
              </div>
            </div>

            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 mb-5 font-mono text-xs text-red-300 break-all max-h-48 overflow-y-auto">
              <p className="font-bold text-zinc-400 mb-1">Error Details:</p>
              {this.state.error?.message || 'Unknown error in Ledger Audit'}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Close Audit
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Render
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
