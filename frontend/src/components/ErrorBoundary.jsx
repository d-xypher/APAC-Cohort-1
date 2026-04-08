import React, { Component } from 'react';

const isDev = import.meta.env.DEV;

/**
 * Error boundary component that catches JavaScript errors in child components.
 * Displays a fallback UI instead of crashing the whole app.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    
    // Log to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // You could also send to an error reporting service here
    // e.g., Sentry.captureException(error);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary-container" style={styles.container}>
          <div className="error-boundary-content" style={styles.content}>
            <div style={styles.iconContainer}>
              <svg 
                style={styles.icon} 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            
            <h2 style={styles.title}>Something went wrong</h2>
            
            <p style={styles.message}>
              CASCADE encountered an unexpected error. Your data is safe, but the application
              needs to recover.
            </p>
            
            {isDev && this.state.error && (
              <details style={styles.details}>
                <summary style={styles.summary}>Error Details (Development Only)</summary>
                <pre style={styles.errorText}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            
            <div style={styles.buttonContainer}>
              <button 
                onClick={this.handleReset} 
                style={styles.buttonSecondary}
              >
                Try Again
              </button>
              <button 
                onClick={this.handleReload} 
                style={styles.buttonPrimary}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: 'var(--bg-primary, #0a0a0f)',
    padding: '20px',
  },
  content: {
    maxWidth: '500px',
    textAlign: 'center',
    padding: '40px',
    backgroundColor: 'var(--bg-secondary, #16161d)',
    borderRadius: '16px',
    border: '1px solid var(--border-color, #2a2a3a)',
  },
  iconContainer: {
    marginBottom: '20px',
  },
  icon: {
    width: '64px',
    height: '64px',
    color: 'var(--warning, #f59e0b)',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '1.5rem',
    fontWeight: '600',
    color: 'var(--text-primary, #ffffff)',
  },
  message: {
    margin: '0 0 24px 0',
    fontSize: '0.95rem',
    lineHeight: '1.6',
    color: 'var(--text-secondary, #a0a0b0)',
  },
  details: {
    marginBottom: '24px',
    textAlign: 'left',
    backgroundColor: 'var(--bg-tertiary, #1a1a24)',
    borderRadius: '8px',
    padding: '12px',
  },
  summary: {
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: 'var(--text-secondary, #a0a0b0)',
    marginBottom: '8px',
  },
  errorText: {
    margin: '8px 0 0 0',
    padding: '12px',
    backgroundColor: 'var(--bg-primary, #0a0a0f)',
    borderRadius: '6px',
    fontSize: '0.75rem',
    color: 'var(--error, #ef4444)',
    overflow: 'auto',
    maxHeight: '200px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  buttonContainer: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  },
  buttonSecondary: {
    padding: '10px 20px',
    fontSize: '0.9rem',
    fontWeight: '500',
    color: 'var(--text-primary, #ffffff)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color, #2a2a3a)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  buttonPrimary: {
    padding: '10px 20px',
    fontSize: '0.9rem',
    fontWeight: '500',
    color: '#ffffff',
    backgroundColor: 'var(--accent, #6366f1)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};

export default ErrorBoundary;
