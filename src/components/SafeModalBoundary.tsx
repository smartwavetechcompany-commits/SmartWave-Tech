import React, { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  onClose?: () => void;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * SafeModalBoundary prevents any error within an overlay modal (such as GuestFolio)
 * from crashing the parent operational dashboard or triggering full application reloads.
 */
export class SafeModalBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('[SafeModalBoundary] Safely contained modal error without system refresh:', error?.message || error);
    if (this.props.onClose) {
      setTimeout(() => {
        try {
          this.props.onClose?.();
        } catch (closeErr) {
          console.warn('[SafeModalBoundary] Error during safe onClose:', closeErr);
        }
      }, 0);
    }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}
