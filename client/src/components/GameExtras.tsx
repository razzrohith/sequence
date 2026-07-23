import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { EMOTES, useStore } from '../store';
import { sfx } from '../sounds';

/** Countdown ring for the turn timer (shot clock). */
export function TurnTimer() {
  const game = useStore((s) => s.game);
  const [now, setNow] = useState(Date.now());
  const lastTick = useRef(0);

  const deadline = game?.turnDeadline ?? null;
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadline]);

  if (!game || !deadline) return null;
  const total = (game.settings.turnSeconds ?? 0) * 1000;
  const left = Math.max(0, deadline - now);
  const secs = Math.ceil(left / 1000);
  const frac = total > 0 ? left / total : 0;
  const urgent = secs <= 5;
  const myTurn =
    game.players[game.turn]?.id === game.yourId && !game.winner && !game.stalemate;

  // tick sound in the last 5 seconds of your own turn
  if (myTurn && urgent && secs !== lastTick.current && secs > 0) {
    lastTick.current = secs;
    sfx.tick();
  }

  return (
    <div className={`turn-timer ${urgent ? 'urgent' : ''}`} title="Time left this turn">
      <svg viewBox="0 0 36 36">
        <circle className="tt-track" cx="18" cy="18" r="15" />
        <circle
          className="tt-fill"
          cx="18"
          cy="18"
          r="15"
          style={{ strokeDashoffset: 94.2 * (1 - frac) }}
        />
      </svg>
      <span className="tt-num">{secs}</span>
    </div>
  );
}

/** Quick-reaction emote bar + the floating emotes others send. */
export function EmoteBar() {
  const sendEmote = useStore((s) => s.sendEmote);
  const [open, setOpen] = useState(false);
  return (
    <div className={`emote-bar ${open ? 'open' : ''}`}>
      <AnimatePresence>
        {open &&
          EMOTES.map((e, i) => (
            <motion.button
              key={e}
              className="emote-opt"
              initial={{ opacity: 0, scale: 0.4, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ delay: i * 0.02 }}
              onClick={() => {
                sendEmote(e);
                setOpen(false);
              }}
            >
              {e}
            </motion.button>
          ))}
      </AnimatePresence>
      <button className="emote-toggle" onClick={() => setOpen((o) => !o)} aria-label="Emotes">
        {open ? '✕' : '😀'}
      </button>
    </div>
  );
}

export function FloatingEmotes() {
  const emotes = useStore((s) => s.emotes);
  return (
    <div className="floating-emotes">
      <AnimatePresence>
        {emotes.map((e) => (
          <motion.div
            key={e.id}
            className="floating-emote"
            initial={{ opacity: 0, y: 20, scale: 0.5 }}
            animate={{ opacity: 1, y: -10, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.8 }}
            transition={{ duration: 0.4 }}
          >
            <span className="fe-emoji">{e.emote}</span>
            <span className={`fe-name ${e.team ?? ''}`}>{e.name}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Undo button (for the player who just moved) + approval prompt for opponents. */
export function UndoControls() {
  const game = useStore((s) => s.game);
  const requestUndo = useStore((s) => s.requestUndo);
  const respondUndo = useStore((s) => s.respondUndo);
  const spectating = useStore((s) => s.spectating);
  if (!game || spectating) return null;

  const req = game.undoRequest;
  // you may request an undo if you made the most recent move and the game is live
  const canRequest =
    !game.winner &&
    !game.stalemate &&
    game.lastMove &&
    game.lastMove.playerId === game.yourId &&
    (game.lastMove.kind === 'place' ||
      game.lastMove.kind === 'remove' ||
      game.lastMove.kind === 'exchangeDead');

  return (
    <>
      {canRequest && !req && (
        <button className="undo-btn" onClick={requestUndo} title="Ask to take back your last move">
          ↩ Undo
        </button>
      )}
      <AnimatePresence>
        {req && (
          <motion.div
            className="undo-request"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <span>
              <b>{req.byName}</b> wants to take back their move.
            </span>
            <div className="undo-actions">
              <button className="btn btn-primary btn-sm" onClick={() => respondUndo(true)}>
                Allow
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => respondUndo(false)}>
                Deny
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
