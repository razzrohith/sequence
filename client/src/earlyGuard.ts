// Imported FIRST in main.tsx so these handlers are registered before any other
// module code runs — a throw during import/init then shows a message instead of
// a blank page (critical for debugging on phones with no devtools).
function showFatal(message: string) {
  const root = document.getElementById('root');
  if (root && root.childElementCount > 0) return; // app already rendered
  if (document.getElementById('fatal-box')) return;
  const box = document.createElement('div');
  box.id = 'fatal-box';
  box.style.cssText =
    'position:fixed;left:12px;right:12px;top:12px;z-index:99999;background:#7f1d1d;color:#fff;' +
    'padding:14px 16px;border-radius:12px;font:14px/1.5 system-ui;word-break:break-word;';
  box.textContent = 'Could not load the game: ' + message + ' — try reloading.';
  document.body.appendChild(box);
}
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) =>
  showFatal(String((e as PromiseRejectionEvent).reason)),
);

export {};
