import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-8 font-sans">
          <h2 className="text-2xl font-bold mb-4">Something went wrong.</h2>
          <pre className="bg-red-900 p-4 rounded text-xs text-left font-mono w-full max-w-2xl overflow-auto mb-4">
              {this.state.error?.message}
              {'\n\n'}
              {this.state.errorInfo?.componentStack}
          </pre>
          <button className="bg-blue-600 px-4 py-2 rounded" onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }

    return this.props.children;
  }
}
