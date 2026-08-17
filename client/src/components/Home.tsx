import { motion } from 'framer-motion';
import { useState } from 'react';
import { dailySeed } from '../../../shared/rng';
import { isIOS, levelForXp, runningStandalone, useStore, xpForStats } from '../store';
import LocalSetup from './LocalSetup';
import Progress from './Progress';
import Rules from './Rules';
import Settings from './Settings';

export default function Home() {
  const name = useStore((s) => s.name);
  const setName = useStore((s) => s.setName);
  const createRoom = useStore((s) => s.createRoom);
  const quickPlay = useStore((s) => s.quickPlay);
  const startDaily = useStore((s) => s.startDaily);
  const startSeed = useStore((s) => s.startSeed);
  const dailyResult = useStore((s) => s.dailyResult);
  const savedLocal = useStore((s) => s.savedLocal);
  const resumeLocal = useStore((s) => s.resumeLocal);
  const joinRoom = useStore((s) => s.joinRoom);
  const spectate = useStore((s) => s.spectate);
  const connected = useStore((s) => s.connected);
  const serverProbed = useStore((s) => s.serverProbed);
  const prefs = useStore((s) => s.prefs);
  const stats = useStore((s) => s.stats);
  const achievements = useStore((s) => s.achievements);
  const installReady = useStore((s) => s.installReady);
  const promptInstall = useStore((s) => s.promptInstall);
  // install/full-screen prompts are pointless inside the installed app
  const standalone = runningStandalone();
  // an invite link (…/?r=CODE) lands you here with the code already filled in
  const [code, setCode] = useState(() => useStore.getState().pendingInvite ?? '');
  const [joinPw, setJoinPw] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showLocal, setShowLocal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [watchMode, setWatchMode] = useState(() => useStore.getState().pendingWatch);
  const level = levelForXp(xpForStats(stats, achievements)).level;
  const [seedInput, setSeedInput] = useState('');
  const [showSeed, setShowSeed] = useState(false);

  // today's challenge is "done" only if the stored result is for today's seed
  const dailyDone = dailyResult && dailyResult.seed === dailySeed();

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
          <p className="tagline">Five in a row wins</p>
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
          <button className="stats-line" onClick={() => setShowProgress(true)}>
            <span className="stats-level">LVL {level}</span>
            🏆 {stats.wins}W · {stats.losses}L · {winRate}% ·{' '}
            {stats.streak > 0 ? `🔥 ${stats.streak} streak` : `${stats.games} games`}
            <span className="stats-more">View progress ›</span>
          </button>
        )}

        {savedLocal && (
          <>
            <div className="mode-title">Unfinished game</div>
            <motion.button
              className="btn btn-primary resume-btn"
              whileTap={{ scale: 0.96 }}
              onClick={resumeLocal}
            >
              ↻ Resume your game
            </motion.button>
          </>
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

        <div className="mode-title">Daily challenge &amp; seeds</div>
        <motion.button
          className={`btn daily-btn ${dailyDone ? 'btn-secondary' : 'btn-primary'}`}
          disabled={!named}
          whileTap={{ scale: 0.96 }}
          onClick={startDaily}
        >
          <span className="daily-ico">🎯</span>
          <span className="daily-text">
            <b>{dailyDone ? "Replay today's challenge" : "Play today's challenge"}</b>
            <i>
              {dailyDone
                ? dailyResult!.won
                  ? `Solved today in ${dailyResult!.moves} moves`
                  : 'Not solved yet today — try again'
                : 'Same deal for everyone, every day'}
            </i>
          </span>
        </motion.button>
        <button className="btn-link seed-toggle" onClick={() => setShowSeed((v) => !v)}>
          {showSeed ? 'Hide seed play' : 'Play a shared seed code'}
        </button>
        {showSeed && (
          <div className="join-row seed-row">
            <input
              className="code-input"
              value={seedInput}
              placeholder="SEED"
              maxLength={12}
              onChange={(e) => setSeedInput(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && named && seedInput && startSeed(seedInput)}
            />
            <motion.button
              className="btn btn-secondary"
              disabled={!named || !seedInput}
              whileTap={{ scale: 0.96 }}
              onClick={() => startSeed(seedInput)}
            >
              Play seed
            </motion.button>
          </div>
        )}

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
              // strip spaces/punctuation first: with maxLength=5 a pasted code
              // with a stray space would otherwise be truncated into a wrong code
              onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                online &&
                code.length === 5 &&
                (watchMode ? spectate(code, joinPw) : joinRoom(code, joinPw))
              }
            />
            <motion.button
              className="btn btn-secondary"
              disabled={!online || code.length !== 5}
              whileTap={{ scale: 0.96 }}
              onClick={() => (watchMode ? spectate(code, joinPw) : joinRoom(code, joinPw))}
            >
              {watchMode ? 'Watch' : 'Join'}
            </motion.button>
          </div>
        </div>
        <input
          className="code-input pw-input"
          type="password"
          placeholder="Room password (if any)"
          maxLength={24}
          value={joinPw}
          onChange={(e) => setJoinPw(e.target.value)}
        />
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

        {/* full-screen app: install where the browser offers it; on iPhone the
            only path is Add to Home Screen, so explain it instead. Phones get
            true full screen; a desktop install opens in its own app window, so
            the promise is worded per platform. */}
        {!standalone && installReady && (
          <>
            <div className="mode-title">Get the app</div>
            <motion.button
              className="btn btn-secondary install-btn"
              whileTap={{ scale: 0.96 }}
              onClick={promptInstall}
            >
              {window.matchMedia('(pointer: coarse)').matches
                ? '📲 Install — full screen, no browser bars, works offline'
                : '🖥 Install the app — its own window, works offline'}
            </motion.button>
          </>
        )}
        {!standalone && !installReady && isIOS() && (
          <>
            <div className="mode-title">Get the app</div>
            <p className="ios-install-hint">
              📲 On iPhone/iPad: tap <b>Share</b> <span className="ios-share">⬆</span> then{' '}
              <b>Add to Home Screen</b>. The game opens full screen like an app, no browser
              bars.
            </p>
          </>
        )}

        {serverProbed && !connected && (
          <p className="hint offline-hint">
            No game server here, so “Play with friends” needs one. <b>Vs computer</b> and{' '}
            <b>Pass &amp; Play</b> work right now.
          </p>
        )}
        {!named && <p className="hint">Enter your name to start.</p>}

        <button className="btn-link" onClick={() => setShowRules(true)}>
          How to play
        </button>
        <p className="home-foot">
          Free browser game · vs AI, online with friends, or pass &amp; play · no download
        </p>
      </motion.div>
      {showRules && <Rules onClose={() => setShowRules(false)} />}
      {showLocal && <LocalSetup onClose={() => setShowLocal(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showProgress && <Progress onClose={() => setShowProgress(false)} />}
    </div>
  );
}
