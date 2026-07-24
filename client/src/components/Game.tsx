import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import type { Team } from '../../../shared/types';
import { EMOTES, useStore } from '../store';
import Board from './Board';
import Chat from './Chat';
import { EmoteBar, FloatingEmotes, TurnTimer, UndoControls } from './GameExtras';
import Hand from './Hand';
import PlayersPanel from './PlayersPanel';
import Rules from './Rules';
import Settings from './Settings';
import WinOverlay from './WinOverlay';

/** In-flow bottom action bar for phones: players, chat, emote, undo. */
function MobileBar({
  openSheet,
  unread,
  online,
  spectating,
  over,
}: {
  openSheet: (w: 'chat' | 'players') => void;
  unread: number;
  online: boolean;
  spectating: boolean;
  over: boolean;
}) {
  const game = useStore((s) => s.game);
  const sendEmote = useStore((s) => s.sendEmote);
  const requestUndo = useStore((s) => s.requestUndo);
  const requestHint = useStore((s) => s.requestHint);
  const [emoteOpen, setEmoteOpen] = useState(false);

  const myTurn =
    !spectating &&
    !over &&
    !!game &&
    game.players[game.turn]?.id === game.yourId;
  const last = game?.lastMove;
  const canUndo =
    !spectating &&
    !over &&
    !!last &&
    last.playerId === game?.yourId &&
    (last.kind === 'place' || last.kind === 'remove' || last.kind === 'exchangeDead') &&
    !game?.undoRequest;

  return (
    <div className="mobile-bar">
      <button className="mb-btn" onClick={() => openSheet('players')}>
        <span className="mb-ico">👥</span>
        <span className="mb-lbl">Players</span>
      </button>
      {online && (
        <button className="mb-btn" onClick={() => openSheet('chat')}>
          <span className="mb-ico">
            💬
            {unread > 0 && <span className="mb-badge">{unread > 9 ? '9+' : unread}</span>}
          </span>
          <span className="mb-lbl">Chat</span>
        </button>
      )}
      {online && !spectating && !over && (
        <div className="mb-emote-wrap">
          <AnimatePresence>
            {emoteOpen && (
              <motion.div
                className="mb-emote-pop"
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
              >
                {EMOTES.map((e) => (
                  <button
                    key={e}
                    className="mb-emote-opt"
                    onClick={() => {
                      sendEmote(e);
                      setEmoteOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <button className="mb-btn" onClick={() => setEmoteOpen((o) => !o)}>
            <span className="mb-ico">{emoteOpen ? '✕' : '😀'}</span>
            <span className="mb-lbl">Emote</span>
          </button>
        </div>
      )}
      {myTurn && (
        <button className="mb-btn" onClick={requestHint}>
          <span className="mb-ico">✦</span>
          <span className="mb-lbl">Hint</span>
        </button>
      )}
      {canUndo && (
        <button className="mb-btn undo" onClick={requestUndo}>
          <span className="mb-ico">↩</span>
          <span className="mb-lbl">Undo</span>
        </button>
      )}
    </div>
  );
}

/** Compact horizontal player strip shown on phones instead of the sidebar */
function MobileStrip() {
  const game = useStore((s) => s.game);
  if (!game) return null;
  const teams = [...new Set(game.players.map((p) => p.team))] as Team[];
  const seqCount = (t: Team) => game.sequences.filter((s) => s.team === t).length;
  return (
    <div className="mobile-strip">
      <div className="ms-scores">
        {teams.map((t) => (
          <span key={t} className="ms-score">
            <span className={`team-dot ${t}`} />
            <span className="ms-pips">
              {Array.from({ length: game.required }).map((_, i) => (
                <span key={i} className={`pip ${i < seqCount(t) ? 'filled' : ''}`} />
              ))}
            </span>
          </span>
        ))}
      </div>
      <div className="ms-players">
        {game.players.map((p, i) => {
          const isTurn = i === game.turn && !game.winner && !game.stalemate;
          return (
            <span key={p.id} className={`ms-player ${isTurn ? 'turn' : ''}`}>
              <span className={`team-dot ${p.team}`} />
              <span className="ms-name">
                {p.id === game.yourId ? 'You' : p.name.slice(0, 10)}
              </span>
              <span className="ms-cards">{p.handCount}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function Game() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const chat = useStore((s) => s.chat);
  const mode = useStore((s) => s.mode);
  const spectating = useStore((s) => s.spectating);
  const setPref = useStore((s) => s.setPref);
  // single source of truth: the header button and the Settings toggle both read
  // prefs.sound, so they can never disagree
  const muted = !useStore((s) => s.prefs.sound);
  const handoffName = useStore((s) => s.handoffName);
  const confirmHandoff = useStore((s) => s.confirmHandoff);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sheet, setSheet] = useState<'chat' | 'players' | null>(null);
  // track the newest message actually seen by time, not by count: the chat list
  // is capped at 100 so lengths saturate and a count-based badge sticks at 0
  const [chatSeenTs, setChatSeenTs] = useState(0);

  if (!game) return null;
  const current = game.players[game.turn];
  const over = !!game.winner || game.stalemate;
  const myTurn = !over && current?.id === game.yourId && !spectating;
  const unread = sheet === 'chat' ? 0 : chat.filter((m) => m.ts > chatSeenTs).length;

  const toggleMute = () => {
    setPref('sound', muted); // muted is the old value, so new sound = old muted
  };

  const openSheet = (which: 'chat' | 'players') => {
    if (which === 'chat') setChatSeenTs(chat.length ? chat[chat.length - 1].ts : Date.now());
    setSheet(which);
  };

  return (
    <div className="game-screen">
      <header className="game-header">
        <div className="gh-left">
          <span className="gh-logo">
            <span className="s-red">♥</span>♠ SEQUENCE
          </span>
          {room && <span className="gh-code">room {room.code}</span>}
        </div>
        <div className="gh-center">
          <TurnTimer />
          <div className={`gh-turn ${myTurn ? 'mine' : ''}`}>
            {spectating
              ? `👁 Spectating — ${over ? 'game over' : `${current?.name}'s turn`}`
              : over
                ? 'Game over'
                : myTurn
                  ? '✦ YOUR TURN — play a card'
                  : `${current?.name}'s turn…`}
          </div>
        </div>
        <div className="gh-right">
          <button className="btn-icon" title="Settings" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
          <button className="btn-icon" title="Rules" onClick={() => setShowRules(true)}>
            ?
          </button>
          <button className="btn-icon" title="Sound" onClick={toggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="btn btn-ghost btn-sm gh-leave" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </header>

      <div className="game-main">
        <aside className="game-side left">
          <PlayersPanel />
        </aside>
        <main className="game-center">
          <MobileStrip />
          <Board />
          {spectating ? (
            <div className="spectator-note">👁 You're spectating — {game.spectatorCount ?? 1} watching</div>
          ) : (
            <Hand />
          )}
        </main>
        <aside className="game-side right">{mode === 'online' && <Chat />}</aside>
      </div>

      {/* mobile bottom toolbar (in-flow, never overlaps the board/hand) */}
      <MobileBar
        openSheet={openSheet}
        unread={unread}
        online={mode === 'online'}
        spectating={spectating}
        over={over}
      />

      {/* desktop-only floating controls (hidden on phones via CSS) */}
      {!spectating && !over && <UndoControls />}
      {mode === 'online' && !over && <EmoteBar />}
      <FloatingEmotes />

      {/* pass-and-play device handoff */}
      <AnimatePresence>
        {handoffName && (
          <motion.div
            key="handoff"
            className="handoff-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={confirmHandoff}
          >
            <motion.div
              className="handoff-card"
              initial={{ scale: 0.85, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 20 }}
            >
              <span className="handoff-icon">🤝</span>
              <h2>Pass the device to</h2>
              <div className="handoff-name">{handoffName}</div>
              <p>Tap anywhere when ready — no peeking!</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* mobile bottom sheets */}
      <AnimatePresence>
        {sheet && (
          <>
            <motion.div
              key="backdrop"
              className="sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheet(null)}
            />
            <motion.div
              key={sheet}
              className="sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              <div className="sheet-grip" onClick={() => setSheet(null)} />
              {sheet === 'chat' ? <Chat /> : <PlayersPanel />}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <WinOverlay />
      {showRules && <Rules onClose={() => setShowRules(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
