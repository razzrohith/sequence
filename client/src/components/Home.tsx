import { motion } from 'framer-motion';
import { useState } from 'react';
import { useStore } from '../store';
import LocalSetup from './LocalSetup';
import Rules from './Rules';
import Settings from './Settings';

export default function Home() {
  const name = useStore((s) => s.name);
  const setName = useStore((s) => s.setName);
  const createRoom = useStore((s) => s.createRoom);
  const quickPlay = useStore((s) => s.quickPlay);
  const joinRoom = useStore((s) => s.joinRoom);
  const spectate = useStore((s) => s.spectate);
  const connected = useStore((s) => s.connected);
  const serverProbed = useStore((s) => s.serverProbed);
  const prefs = useStore((s) => s.prefs);
  const stats = useStore((s) => s.stats);
  const [code, setCode] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showLocal, setShowLocal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [watchMode, setWatchMode] = useState(false);

  const named = name.trim().length > 0;
  const online = connected && named;
  const winRate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;

  return (
    <div className="home">
      <motion.div
        className="home-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16 }}
      >
        <div className="logo">
          <span className="logo-suits">
            <span className="s-red">♥</span>
            <span>♠</span>
            <span className="s-red">♦</span>
            <span>♣</span>
          </span>
          <h1>SEQUENCE</h1>
          <p className="tagline">five in a row wins — an exciting game of strategy</p>
        </div>

        <div className="name-row">
          <button
            className="avatar-btn"
            title="Change avatar & settings"
            onClick={() => setShowSettings(true)}
          >
            {prefs.avatar}
          </button>
          <label className="field name-field">
            <span>Your name</span>
            <input
              value={name}
              maxLength={20}
              placeholder="e.g. Rohith"
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
        </div>
        {stats.games > 0 && (
          <div className="stats-line">
            🏆 {stats.wins}W · {stats.losses}L · {stats.games} games · {winRate}% win rate
          </div>
        )}

        <div className="mode-title">Play vs computer</div>
        <div className="quick-row">
          <motion.button
            className="btn btn-primary quick-btn"
            disabled={!named}
            whileTap={{ scale: 0.96 }}
            onClick={() => quickPlay(2)}
          >
            ▶ 1 vs 1
          </motion.button>
          <motion.button
            className="btn btn-secondary quick-btn"
            disabled={!named}
            whileTap={{ scale: 0.96 }}
            onClick={() => quickPlay(3)}
          >
            3-way
          </motion.button>
          <motion.button
            className="btn btn-secondary quick-btn"
            disabled={!named}
            whileTap={{ scale: 0.96 }}
            onClick={() => quickPlay(4)}
          >
            2 vs 2
          </motion.button>
        </div>

        <div className="mode-title">Play with friends</div>
        <div className="friends-row">
          <motion.button
            className="btn btn-secondary"
            disabled={!online}
            whileTap={{ scale: 0.96 }}
            onClick={createRoom}
          >
            Create a room
          </motion.button>
          <div className="join-row">
            <input
              className="code-input"
              value={code}
              placeholder="CODE"
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                online &&
                code.length === 5 &&
                (watchMode ? spectate(code) : joinRoom(code))
              }
            />
            <motion.button
              className="btn btn-secondary"
              disabled={!online || code.length !== 5}
              whileTap={{ scale: 0.96 }}
              onClick={() => (watchMode ? spectate(code) : joinRoom(code))}
            >
              {watchMode ? 'Watch' : 'Join'}
            </motion.button>
          </div>
        </div>
        <label className="watch-toggle">
          <input
            type="checkbox"
            checked={watchMode}
            onChange={(e) => setWatchMode(e.target.checked)}
          />
          <span>👁 Watch as spectator instead of joining</span>
        </label>

        <div className="mode-title">Play on this device</div>
        <motion.button
          className="btn btn-secondary"
          disabled={!named}
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowLocal(true)}
        >
          🤝 Pass &amp; Play (works offline)
        </motion.button>

        {serverProbed && !connected && (
          <p className="hint offline-hint">
            No game server here — “Play with friends” needs one. <b>Vs computer</b> and{' '}
            <b>Pass &amp; Play</b> work right now.
          </p>
        )}
        {!named && <p className="hint">Enter your name to start.</p>}

        <button className="btn-link" onClick={() => setShowRules(true)}>
          How to play
        </button>
      </motion.div>
      {showRules && <Rules onClose={() => setShowRules(false)} />}
      {showLocal && <LocalSetup onClose={() => setShowLocal(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
