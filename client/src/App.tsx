import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useEffect } from 'react';
import Game from './components/Game';
import Home from './components/Home';
import Lobby from './components/Lobby';
import { useStore } from './store';

export default function App() {
  const view = useStore((s) => s.view);
  const connected = useStore((s) => s.connected);
  const serverProbed = useStore((s) => s.serverProbed);
  const toasts = useStore((s) => s.toasts);
  const reducedMotion = useStore((s) => s.prefs.reducedMotion);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  // NOTE: view switching deliberately animates on entry only — an exit-blocking
  // AnimatePresence (mode="wait") can stall forever in a backgrounded tab
  // where requestAnimationFrame is throttled.
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
    <div className="app">
      <div className="rotate-overlay">
        <span className="ro-icon">📱</span>
        <b>Rotate your device</b>
        <span>Sequence plays best in portrait.</span>
      </div>
      {!connected && !serverProbed && (
        <div className="conn-banner">
          <span className="spinner" /> Connecting to server…
        </div>
      )}

      {view === 'home' && (
        <motion.div
          key="home"
          className="view"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Home />
        </motion.div>
      )}
      {view === 'lobby' && (
        <motion.div
          key="lobby"
          className="view"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Lobby />
        </motion.div>
      )}
      {view === 'game' && (
        <motion.div
          key="game"
          className="view view-game"
          // opacity-only: a lingering scale transform would (a) make position:fixed
          // children anchor to this box instead of the viewport and (b) shrink the
          // layout, leaving a gap at the bottom on tall phones
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Game />
        </motion.div>
      )}

      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast toast-${t.kind}`}
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              layout
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
    </MotionConfig>
  );
}
