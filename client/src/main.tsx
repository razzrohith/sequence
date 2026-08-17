import './earlyGuard'; // MUST be first, registers crash guards before other imports run
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// PWA: offline app shell + installability (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Install-app offers live in the store (beforeinstallprompt -> installReady) and
// render as a calm "Get the app" section on Home — no overlay bar. One listener
// only: the browser's install event may be prompt()ed just once, so two UIs
// holding the same event would break each other.
