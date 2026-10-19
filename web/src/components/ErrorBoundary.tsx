import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Top-level crash guard: renders a friendly card instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CodeStream UI crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-wrap">
        <div className="card crash-card">
          <h2>Something went wrong</h2>
          <p className="muted">{error.message || 'An unexpected error occurred while rendering.'}</p>
          <div className="crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
              Reload
            </button>
            <a className="btn btn-secondary" href="/">
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
