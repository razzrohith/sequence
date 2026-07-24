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

// Offer "add to home screen" once, on the player's own terms: the browser fires
// beforeinstallprompt, we hold onto it and show our own unobtrusive button.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  const deferred = e as Event & { prompt: () => Promise<void> };
  if (localStorage.getItem('seq:installDismissed') === '1') return;

  const bar = document.createElement('div');
  bar.className = 'install-bar';
  bar.innerHTML =
    '<span>Install Sequence for full-screen, offline play.</span>' +
    '<button class="ib-yes">Install</button><button class="ib-no">Not now</button>';
  document.body.appendChild(bar);

  const close = () => bar.remove();
  bar.querySelector('.ib-yes')?.addEventListener('click', async () => {
    close();
    try {
      await deferred.prompt();
    } catch {
      /* dismissed */
    }
  });
  bar.querySelector('.ib-no')?.addEventListener('click', () => {
    localStorage.setItem('seq:installDismissed', '1');
    close();
  });
});
