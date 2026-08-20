import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Team } from '../../../shared/types';
import { EMOTES, isIOS, isIOSSafari, isIPhone, runningStandalone, useStore } from '../store';
import Board from './Board';
import Chat from './Chat';
import { EmoteBar, FloatingEmotes, TurnTimer, UndoControls } from './GameExtras';
import Hand from './Hand';
import PlayersPanel from './PlayersPanel';
import Rules from './Rules';
import Settings from './Settings';
import WinOverlay from './WinOverlay';

// Element fullscreen works on Android, desktop and iPadOS (older WebKit only
// through the webkit- prefix), but iPhone Safari has no fullscreen at all. There
// the installed app (Add to Home Screen) is the only way to lose the browser
// bars, so the button explains that instead of silently doing nothing.
// the DOM types declare these as always present, but they genuinely are not on
// older WebKit, so describe them as optional to make the feature checks real
interface FsEl {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FsDoc {
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
const fsDoc = () => document as unknown as FsDoc;
const fsRoot = () => document.documentElement as unknown as FsEl;

/** The method existing is not enough: inside an iframe without
 * allow="fullscreen" it stays defined but always rejects, which would leave a
 * visible button that silently does nothing. The *Enabled flag covers that. */
function fullscreenSupported(): boolean {
  const d = fsDoc();
  const el = fsRoot();
  if (el.requestFullscreen) return d.fullscreenEnabled !== false;
  // iPhone Safari exposes the legacy webkit method but cannot actually go
  // fullscreen, and reports webkitFullscreenEnabled false (iPad reports true),
  // so this path must demand an explicit yes rather than merely "not false"
  if (el.webkitRequestFullscreen) return d.webkitFullscreenEnabled === true;
  return false;
}
function currentFsElement(): Element | null {
  const d = fsDoc();
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}
function enterFullscreen() {
  const el = fsRoot();
  try {
    if (el.requestFullscreen) void Promise.resolve(el.requestFullscreen()).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* refused */
  }
}
function leaveFullscreen() {
  const d = fsDoc();
  try {
    if (d.exitFullscreen) void Promise.resolve(d.exitFullscreen()).catch(() => {});
    else d.webkitExitFullscreen?.();
  } catch {
    /* refused */
  }
}

/** Shown when the expand button is tapped on an iOS device with no fullscreen
 * API, where the Home Screen app is the only way to lose the browser bars. The
 * wording follows the actual device and browser: iPad keeps Share in the top
 * toolbar, and non-Safari iOS browsers need Safari for Add to Home Screen. */
function IosFullscreenHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const phone = isIPhone();
  const device = phone ? 'iPhone' : 'iPad';
  const safari = isIOSSafari();
  const shareWhere = phone ? 'the bottom bar' : 'the top toolbar';
  const host = typeof window !== 'undefined' ? window.location.host : 'this site';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal ios-fs-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-fs-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <button ref={closeRef} className="modal-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2 id="ios-fs-title">Full screen on {device}</h2>
        {safari ? (
          <>
            <p className="ios-fs-lead">
              Safari never lets a web page take the whole screen. Add Sequence to your Home Screen
              once and it opens like a real app, with no address bar and no toolbar.
            </p>
            <ol className="ios-fs-steps">
              <li>
                Tap <b>Share</b> <span className="ios-share">⬆</span> in {shareWhere}
              </li>
              <li>
                Scroll down and tap <b>Add to Home Screen</b>
              </li>
              <li>
                Tap <b>Add</b>, then open Sequence from your Home Screen
              </li>
            </ol>
          </>
        ) : (
          <>
            <p className="ios-fs-lead">
              This browser can&rsquo;t give a web page the whole screen on {device}. Open Sequence
              in <b>Safari</b> and add it to your Home Screen, and it opens like a real app with no
              browser bars.
            </p>
            <ol className="ios-fs-steps">
              <li>
                Open <b>{host}</b> in Safari
              </li>
              <li>
                Tap <b>Share</b> <span className="ios-share">⬆</span>, then{' '}
                <b>Add to Home Screen</b>
              </li>
              <li>Open Sequence from your Home Screen</li>
            </ol>
          </>
        )}
        <p className="ios-fs-note">
          This game keeps playing in this tab, so you can finish it here and add the app later.
        </p>
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </motion.div>
    </div>
  );
}

function FullscreenButton() {
  const [fs, setFs] = useState(() => !!currentFsElement());
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const on = () => setFs(!!currentFsElement());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);

  const native = fullscreenSupported();
  // iOS with no fullscreen API at all: we can still show the way to get there
  const explainOnly = !native && isIOS();
  // nothing useful to offer on this platform
  if (!native && !explainOnly) return null;
  // only the INSTALLED iOS app is already edge to edge. An installed app on
  // Android/desktop is merely "standalone" (status bar / window frame remain),
  // so it keeps the real fullscreen button.
  if (explainOnly && runningStandalone()) return null;

  const label = explainOnly ? 'How to play full screen' : fs ? 'Exit full screen' : 'Full screen';
  return (
    <>
      <button
        className="btn-icon gh-fs"
        title={label}
        aria-label={label}
        aria-haspopup={explainOnly ? 'dialog' : undefined}
        aria-expanded={explainOnly ? help : undefined}
        aria-pressed={explainOnly ? undefined : fs}
        onClick={() => {
          if (explainOnly) {
            setHelp(true);
            return;
          }
          if (currentFsElement()) leaveFullscreen();
          else enterFullscreen();
        }}
      >
        {!explainOnly && fs ? '⤢' : '⛶'}
      </button>
      {help && <IosFullscreenHelp onClose={() => setHelp(false)} />}
    </>
  );
}

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
  // hard level always hides the hint so you work each move out yourself
  const hard = useStore((s) => s.prefs.gameLevel === 'hard');
  const [emoteOpen, setEmoteOpen] = useState(false);

  // hints can be switched off for the room in the lobby
  const canHint =
    !hard &&
    !spectating &&
    !over &&
    !!game &&
    game.settings.hints === true &&
    game.players[game.turn]?.id === game.yourId;
  const last = game?.lastMove;
  const canUndo =
    (game?.settings.undoMode ?? 'approval') !== 'off' &&
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
      {canHint && (
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
              {Array.from({ length: game.requiredByTeam?.[t] ?? game.required }).map((_, i) => (
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
          <div className={`gh-turn ${myTurn ? 'mine' : ''} ${!myTurn && current?.away ? 'away' : ''}`}>
            {spectating
              ? `👁 Spectating: ${over ? 'game over' : `${current?.name}'s turn`}`
              : over
                ? 'Game over'
                : myTurn
                  ? '✦ YOUR TURN: play a card'
                  : current?.away
                    ? `⏸ ${current?.name} is away — waiting…`
                    : `${current?.name}'s turn…`}
          </div>
        </div>
        <div className="gh-right">
          <FullscreenButton />
          <button className="btn-icon" title="Settings" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
          <button className="btn-icon" title="Rules" onClick={() => setShowRules(true)}>
            ?
          </button>
          <button className="btn-icon" title="Sound" onClick={toggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            className="btn btn-ghost btn-sm gh-leave"
            onClick={() => {
              // warn a host with other humans present: leaving hands the game over
              const iAmHost = mode === 'online' && room?.hostId === game.yourId;
              const otherHumans = game.players.filter(
                (p) => !p.isBot && p.id !== game.yourId,
              ).length;
              if (
                iAmHost &&
                otherHumans > 0 &&
                !game.winner &&
                !game.stalemate &&
                !window.confirm(
                  "You're the host. Leaving hands the game to the next player. Leave anyway?",
                )
              )
                return;
              leaveRoom();
            }}
          >
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
            <div className="spectator-note">👁 You're spectating. {game.spectatorCount ?? 1} watching</div>
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
              <p>Tap anywhere when ready. No peeking!</p>
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
