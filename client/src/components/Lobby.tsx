import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { BOARD_THEMES, useStore } from '../store';
import Rules from './Rules';

const TEAM_LABEL: Record<string, string> = { red: 'Red', blue: 'Blue', green: 'Green' };

export default function Lobby() {
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const addBot = useStore((s) => s.addBot);
  const removePlayer = useStore((s) => s.removePlayer);
  const updateSettings = useStore((s) => s.updateSettings);
  const startGame = useStore((s) => s.startGame);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const toast = useStore((s) => s.toast);
  const [showRules, setShowRules] = useState(false);
  const [lanUrl, setLanUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/netinfo')
      .then((r) => r.json())
      .then((info: { port: number; addresses: string[] }) => {
        if (info.addresses?.length) setLanUrl(`http://${info.addresses[0]}:${info.port}`);
      })
      .catch(() => {});
  }, []);

  if (!room) return null;
  const isHost = room.hostId === playerId;
  const n = room.players.length;
  const validCount = room.validCounts.includes(n);
  const canPickTeams = n % 6 === 0; // both 2 and 3 teams divide evenly

  // share a one-tap invite link; friends land on Home with the code prefilled
  const copyLink = async () => {
    const link = `${window.location.origin}${window.location.pathname}?r=${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied!');
    } catch {
      toast(link, 'info');
    }
  };
  // copying the bare code avoids anyone having to read it off the screen
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast('Room code copied!');
    } catch {
      toast(room.code, 'info');
    }
  };

  return (
    <div className="lobby">
      <motion.div
        className="lobby-card"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 130, damping: 17 }}
      >
        <div className="lobby-head">
          <h2>Game Lobby</h2>
          <button className="btn-link" onClick={() => setShowRules(true)}>
            How to play
          </button>
        </div>

        <div className="room-code">
          <span className="rc-label">ROOM CODE</span>
          <span className="rc-value">{room.code}</span>
          <div className="rc-actions">
            <button className="rc-btn" onClick={copyLink}>
              ⧉ Copy invite link
            </button>
            <button className="rc-btn" onClick={copyCode}>
              ⧉ Copy code
            </button>
          </div>
        </div>

        {lanUrl && (
          <div
            className="lan-info"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${lanUrl} (room code ${room.code})`);
                toast('Join link copied!');
              } catch {
                /* clipboard unavailable */
              }
            }}
            title="Click to copy"
          >
            📶 Friends on your Wi-Fi join at <b>{lanUrl}</b> with code <b>{room.code}</b>
            <span className="rc-copy">⧉</span>
          </div>
        )}

        <div className="player-list">
          <AnimatePresence>
            {room.players.map((p) => (
              <motion.div
                key={p.id}
                className="player-row"
                initial={{ opacity: 0, x: -18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 18 }}
                layout
              >
                <span className={`team-dot ${p.team ?? 'none'}`} />
                <span className="player-avatar">{p.avatar ?? (p.isBot ? '🤖' : '🙂')}</span>
                <span className="player-name">
                  <span className="player-name-text">{p.name}</span>
                  {p.id === room.hostId && <span className="badge host">HOST</span>}
                  {p.isBot && <span className="badge bot">AI</span>}
                  {p.id === playerId && <span className="badge you">YOU</span>}
                </span>
                <span className="player-team">{p.team ? TEAM_LABEL[p.team] : '-'}</span>
                {isHost && p.id !== playerId && !room.started && (
                  <button className="btn-icon" title="Remove" onClick={() => removePlayer(p.id)}>
                    ✕
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {isHost && (
          <div className="lobby-controls">
            <motion.button
              className="btn btn-secondary"
              whileTap={{ scale: 0.96 }}
              onClick={addBot}
              disabled={n >= 12}
            >
              + Add AI bot
            </motion.button>

            {canPickTeams && (
              <div className="seg">
                <span className="seg-label">Teams</span>
                <button
                  className={`seg-btn ${room.settings.teamCount === 2 ? 'on' : ''}`}
                  onClick={() => updateSettings({ teamCount: 2 })}
                >
                  2
                </button>
                <button
                  className={`seg-btn ${room.settings.teamCount === 3 ? 'on' : ''}`}
                  onClick={() => updateSettings({ teamCount: 3 })}
                >
                  3
                </button>
              </div>
            )}

            <div className="seg">
              <span className="seg-label">AI</span>
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  className={`seg-btn ${room.settings.botDifficulty === d ? 'on' : ''}`}
                  onClick={() => updateSettings({ botDifficulty: d })}
                >
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>

            <div className="seg">
              <span className="seg-label">Turn timer</span>
              {[
                [0, 'Off'],
                [30, '30s'],
                [60, '60s'],
              ].map(([v, lbl]) => (
                <button
                  key={v}
                  className={`seg-btn ${room.settings.turnSeconds === v ? 'on' : ''}`}
                  onClick={() => updateSettings({ turnSeconds: v as number })}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="seg seg-wrap">
              <span className="seg-label">Board for everyone</span>
              {BOARD_THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`seg-btn ${(room.settings.boardTheme ?? 'classic') === t.id ? 'on' : ''}`}
                  onClick={() => updateSettings({ boardTheme: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {room.settings.teamCount === 2 && (
              <div className="seg">
                <span className="seg-label">Sequences to win</span>
                {[
                  [1, '1 (quick)'],
                  [2, '2 (standard)'],
                ].map(([v, lbl]) => (
                  <button
                    key={v}
                    className={`seg-btn ${(room.settings.winSequences ?? 2) === v ? 'on' : ''}`}
                    onClick={() => updateSettings({ winSequences: v as number })}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}

            <label className="check">
              <input
                type="checkbox"
                checked={!!room.settings.randomBoard}
                onChange={(e) => updateSettings({ randomBoard: e.target.checked })}
              />
              <span>
                Shuffle the board <i>(deal the cards to random spaces instead of the
                printed board)</i>
              </span>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={room.settings.strictDraw}
                onChange={(e) => updateSettings({ strictDraw: e.target.checked })}
              />
              <span>
                Strict draw rule <i>(forget to draw → forfeit the card)</i>
              </span>
            </label>
          </div>
        )}

        {room.spectatorCount > 0 && (
          <div className="spectator-count">👁 {room.spectatorCount} watching</div>
        )}

        <div className={`count-status ${validCount ? 'ok' : 'bad'}`}>
          {validCount
            ? `${n} player${n > 1 ? 's' : ''}, ${room.settings.teamCount} teams, ready to deal`
            : `Need ${room.validCounts.join(' / ')} players (currently ${n}). Add bots or friends`}
        </div>

        <div className="lobby-actions">
          <button className="btn btn-ghost" onClick={leaveRoom}>
            Leave
          </button>
          {isHost ? (
            <motion.button
              className="btn btn-primary btn-big"
              disabled={!validCount}
              whileHover={{ scale: validCount ? 1.03 : 1 }}
              whileTap={{ scale: 0.97 }}
              onClick={startGame}
            >
              Deal the cards ▸
            </motion.button>
          ) : (
            <span className="waiting">
              <span className="spinner" /> Waiting for the host to start…
            </span>
          )}
        </div>
      </motion.div>
      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </div>
  );
}
