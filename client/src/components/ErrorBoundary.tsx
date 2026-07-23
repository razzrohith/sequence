import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Catches render/effect throws so a bug shows a recovery screen, not a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <div className="crash-card">
            <span className="crash-icon">🎴</span>
            <h2>Something went wrong</h2>
            <p>The game hit an unexpected error. Reloading usually fixes it.</p>
            <div className="crash-actions">
              <button
                className="btn btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  try {
                    localStorage.removeItem('seq:lastRoom');
                  } catch {
                    /* ignore */
                  }
                  window.location.href = '/';
                }}
              >
                Back to home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
