import { create } from 'zustand';
import { chooseBotMove } from '../../shared/bot';
import {
  applyMove,
  createGame,
  defaultSettings,
  forceLegalMove,
  toClientState,
} from '../../shared/game';
import type {
  BotDifficulty,
  Card,
  ChatMessage,
  ClientGameState,
  EmoteMessage,
  GameCore,
  Move,
  RoomInfo,
  ServerPlayer,
} from '../../shared/types';
import { TEAMS } from '../../shared/types';
import { NetGuest, NetHost, type NetHandlers } from './net';
import { setHaptics, setMuted, setVolume, sfx } from './sounds';

export type View = 'home' | 'lobby' | 'game';
export type Mode = 'online' | 'local';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'gold';
}

export interface LocalSeat {
  name: string;
  isBot: boolean;
}

export interface Prefs {
  sound: boolean;
  /** 0..1 master volume for the sound engine */
  volume: number;
  /** keep your hand ordered automatically */
  sortHand: 'off' | 'suit' | 'rank';
  /** tap a cell twice before the chip is committed */
  confirmPlace: boolean;
  /** mirror the hand and toolbar for left-handed play */
  leftHanded: boolean;
  /** notify me when it becomes my turn and the tab is in the background */
  notifyTurn: boolean;
  cardBack: string;
  chipStyle: string;
  /** board shape: tall (portrait, default) or wide (rotated for wide screens) */
  boardLayout: 'portrait' | 'landscape';
  haptics: boolean;
  colorblind: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  avatar: string;
  difficulty: BotDifficulty;
  boardTheme: string;
}

export const CARD_BACKS = [
  { id: 'classic', label: 'Blue' },
  { id: 'crimson', label: 'Red' },
  { id: 'forest', label: 'Green' },
  { id: 'ink', label: 'Ink' },
];

export const CHIP_STYLES = [
  { id: 'plastic', label: 'Plastic' },
  { id: 'glass', label: 'Glass' },
  { id: 'wood', label: 'Wood' },
  { id: 'metal', label: 'Metal' },
];

export const BOARD_THEMES = [
  { id: 'classic', label: 'Silver' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'walnut', label: 'Walnut' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'ocean', label: 'Ocean' },
  // showpiece animated themes
  { id: 'galaxy', label: '🌌 Dark Universe' },
  { id: 'abyss', label: '🌊 Deep Sea' },
  { id: 'inferno', label: '🔥 Inferno' },
  { id: 'aurora', label: '✨ Aurora' },
];

export interface Stats {
  wins: number;
  losses: number;
  games: number;
}

export interface FloatingEmote {
  id: number;
  emote: string;
  name: string;
  team: string | null;
}

export const AVATARS = ['🦊', '🐼', '🦉', '🐙', '🦁', '🐸', '🐨', '🦄', '🐝', '🐳', '🦖', '👽'];
export const EMOTES = [
  // reactions
  '👍', '👎', '😂', '🤣', '😮', '😱', '🔥', '😎', '😭', '🥲', '🤔', '🤯', '🥳', '🎉',
  // playful trash talk
  '😏', '😜', '🙃', '😈', '🤡', '💀', '🫠', '🙈', '🤌', '👀', '🧠', '🐐', '💩', '🥱',
  // couples
  '❤️', '😍', '🥰', '😘', '💋', '💕', '💘', '👩‍❤️‍👨', '🌹', '🥺', '👉👈', '💍',
  // game flavour
  '🍀', '🎯', '♠️', '♥️', '♦️', '♣️', '🃏', '🏆', '🧊', '⚡',
];

let toastId = 0;
let emoteId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** localStorage throws in some privacy modes / insecure contexts, never let
 * that crash the app; fall back to an in-memory map. */
const memStore: Record<string, string> = {};
const LS = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return k in memStore ? memStore[k] : null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      memStore[k] = v;
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      delete memStore[k];
    }
  },
};

/** crypto.randomUUID is unavailable on insecure origins (e.g. http://192.168.x.x
 * on a phone), so fall back to getRandomValues, then Math.random. */
function makeId(): string {
  try {
    const c: Partial<Crypto> | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const bytes = c.getRandomValues(new Uint8Array(16));
      return 'p-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadPrefs(): Prefs {
  let saved: Partial<Prefs> = {};
  try {
    saved = JSON.parse(LS.get('seq:prefs') ?? '{}');
  } catch {
    /* ignore */
  }
  return {
    sound: saved.sound ?? true,
    volume: typeof saved.volume === 'number' ? saved.volume : 0.8,
    sortHand: saved.sortHand ?? 'off',
    confirmPlace: saved.confirmPlace ?? false,
    leftHanded: saved.leftHanded ?? false,
    notifyTurn: saved.notifyTurn ?? false,
    cardBack: saved.cardBack ?? 'classic',
    chipStyle: saved.chipStyle ?? 'plastic',
    boardLayout: saved.boardLayout ?? 'portrait',
    haptics: saved.haptics ?? true,
    colorblind: saved.colorblind ?? false,
    reducedMotion: saved.reducedMotion ?? prefersReducedMotion(),
    highContrast: saved.highContrast ?? false,
    avatar: saved.avatar ?? AVATARS[0],
    difficulty: saved.difficulty ?? 'medium',
    boardTheme: saved.boardTheme ?? 'classic',
  };
}

/** Initial reduced-motion default follows the OS/browser accessibility setting. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const LOCAL_GAME_KEY = 'seq:localGame';

export interface SavedLocal {
  core: GameCore;
  seats: LocalSeat[];
  viewer: string | null;
}

/** Persist an in-progress solo / pass-and-play game so a refresh doesn't lose it.
 * JSON.stringify drops the core's `rng` function; it's restored on load (the deck
 * order is already fixed in the saved state, so play continues identically). */
function saveLocalGame(core: GameCore, seats: LocalSeat[], viewer: string | null) {
  try {
    if (core.winner || core.stalemate) {
      LS.remove(LOCAL_GAME_KEY);
      return;
    }
    LS.set(LOCAL_GAME_KEY, JSON.stringify({ core, seats, viewer }));
  } catch {
    /* ignore */
  }
}

function loadLocalGame(): SavedLocal | null {
  try {
    const raw = LS.get(LOCAL_GAME_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedLocal;
    if (!d?.core?.players?.length || d.core.winner || d.core.stalemate) return null;
    d.core.rng = Math.random;
    return d;
  } catch {
    return null;
  }
}

function loadStats(): Stats {
  try {
    const s = JSON.parse(LS.get('seq:stats') ?? '{}');
    return { wins: s.wins ?? 0, losses: s.losses ?? 0, games: s.games ?? 0 };
  } catch {
    return { wins: 0, losses: 0, games: 0 };
  }
}

/** Board-theme precedence, so both "change mine" and "change for everyone" work:
 *  - the room's board (host's "for everyone" pick) is the shared default;
 *  - a player can override it just for themselves ("change mine");
 *  - but when the host changes the room board again, that re-syncs everyone,
 *    clearing personal overrides, so "everyone's board changes" really happens.
 * We detect a host change by the room theme value changing. */
let boardOverridden = false;
let lastRoomTheme: string | undefined;

function applyBoardTheme(roomTheme: string | undefined, prefTheme: string) {
  try {
    const theme = boardOverridden ? prefTheme : roomTheme || prefTheme;
    document.body.dataset.board = theme || 'classic';
  } catch {
    /* SSR/no-dom */
  }
}

/** A quiet nudge when it becomes your turn while the tab is in the background.
 * Never fires while the tab is visible, that is what the sound is for. */
function notifyMyTurn(enabled: boolean) {
  if (!enabled) return;
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    const n = new Notification('Sequence', { body: 'It is your turn.', tag: 'seq-turn' });
    setTimeout(() => n.close(), 8000);
  } catch {
    /* notifications unavailable */
  }
}

/** Apply prefs that have global side effects (sound engine, colorblind body class). */
function applyPrefs(p: Prefs, roomTheme?: string) {
  setMuted(!p.sound);
  setVolume(p.volume ?? 0.8);
  setHaptics(p.haptics);
  try {
    document.body.classList.toggle('colorblind', p.colorblind);
    document.body.classList.toggle('reduce-motion', p.reducedMotion);
    document.body.classList.toggle('high-contrast', p.highContrast);
    document.body.classList.toggle('left-handed', p.leftHanded);
    document.body.dataset.cardBack = p.cardBack || 'classic';
    document.body.dataset.chip = p.chipStyle || 'plastic';
    document.body.dataset.orient = p.boardLayout || 'portrait';
  } catch {
    /* SSR/no-dom */
  }
  applyBoardTheme(roomTheme, p.boardTheme);
}

/** A shared invite link (…/?r=CODE) prefills the join field. Read at module load
 * so it's available before the first render, then stripped from the URL so a
 * refresh doesn't re-trigger it. */
function readInvite(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('r') ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(raw)) return null;
    params.delete('r');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    return raw;
  } catch {
    return null;
  }
}
const INVITE_CODE = readInvite();

function getPlayerId(): string {
  let id = LS.get('seq:playerId');
  if (!id) {
    id = makeId();
    LS.set('seq:playerId', id);
  }
  return id;
}

interface Store {
  /** online multiplayer relays through a public message broker, no server to host */
  net: NetHost | NetGuest | null;
  netKind: 'host' | 'guest' | null;
  connected: boolean;
  serverProbed: boolean;
  view: View;
  mode: Mode;
  name: string;
  playerId: string;
  room: RoomInfo | null;
  game: ClientGameState | null;
  chat: ChatMessage[];
  toasts: Toast[];
  selectedCard: Card | null;
  /** a card held down to preview its legal cells, without committing to it */
  previewCard: Card | null;
  /** suggested move; `turn` pins it so it self-expires once the turn moves on */
  hint: { card: Card; r: number; c: number; turn: number } | null;
  /** room code from an invite link, used to prefill the join field */
  pendingInvite: string | null;
  rejoining: boolean;
  lastEventSeen: number;
  wasMyTurn: boolean;

  prefs: Prefs;
  stats: Stats;
  emotes: FloatingEmote[];
  spectating: boolean;

  /** an in-progress solo/pass-and-play game recovered from a previous session */
  savedLocal: SavedLocal | null;
  resumeLocal: () => void;

  // local pass-and-play
  localCore: GameCore | null;
  localSeats: LocalSeat[];
  localViewer: string | null;
  handoffName: string | null;
  localBotTimer: number | null;
  /** snapshot of the local core taken before the last on-device move, for undo */
  localUndo: string | null;

  init: () => void;
  netHandlers: () => NetHandlers;
  _goHome: () => void;
  setName: (n: string) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  createRoom: () => void;
  quickPlay: (players: number) => void;
  joinRoom: (code: string, password?: string) => void;
  spectate: (code: string, password?: string) => void;
  leaveRoom: () => void;
  addBot: () => void;
  removePlayer: (id: string) => void;
  updateSettings: (s: {
    teamCount?: number;
    strictDraw?: boolean;
    botDifficulty?: BotDifficulty;
    turnSeconds?: number;
    winSequences?: number;
    boardTheme?: string;
    randomBoard?: boolean;
    powerCards?: boolean;
    undoMode?: 'off' | 'instant' | 'approval';
    hints?: boolean;
    firstPlayer?: 'first' | 'random';
    allowDeadExchange?: boolean;
    clockSeconds?: number;
    handicapTeam?: string;
    handicapExtra?: number;
    password?: string;
    teamChat?: boolean;
  }) => void;
  startGame: () => void;
  playMove: (move: Move) => void;
  rematch: () => void;
  sendChat: (text: string) => void;
  sendEmote: (emote: string) => void;
  requestUndo: () => void;
  respondUndo: (approve: boolean) => void;
  selectCard: (card: Card | null) => void;
  previewCardSet: (card: Card | null) => void;
  requestHint: () => void;
  setReady: (v: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  ingestGameState: (game: ClientGameState) => void;

  startLocal: (seats: LocalSeat[]) => void;
  confirmHandoff: () => void;
  localTick: () => void;
}

const initialPrefs = loadPrefs();
applyPrefs(initialPrefs);

export const useStore = create<Store>((set, get) => ({
  net: null,
  netKind: null,
  connected: true,
  serverProbed: true,
  view: 'home',
  mode: 'online',
  name: LS.get('seq:name') ?? '',
  playerId: getPlayerId(),
  room: null,
  game: null,
  chat: [],
  toasts: [],
  selectedCard: null,
  previewCard: null,
  hint: null,
  pendingInvite: INVITE_CODE,
  rejoining: false,
  lastEventSeen: 0,
  wasMyTurn: false,

  prefs: initialPrefs,
  stats: loadStats(),
  emotes: [],
  spectating: false,

  savedLocal: loadLocalGame(),
  localCore: null,
  localSeats: [],
  localUndo: null,
  localViewer: null,
  handoffName: null,
  localBotTimer: null,

  toast(text, kind = 'info') {
    const t: Toast = { id: ++toastId, text, kind };
    set((s) => {
      // dismiss overflow toasts (and clear their timers) instead of orphaning them
      const kept = [...s.toasts, t];
      while (kept.length > 4) {
        const dropped = kept.shift();
        if (dropped) {
          const tm = toastTimers.get(dropped.id);
          if (tm) {
            clearTimeout(tm);
            toastTimers.delete(dropped.id);
          }
        }
      }
      return { toasts: kept };
    });
    toastTimers.set(
      t.id,
      setTimeout(() => get().dismissToast(t.id), 4200),
    );
  },
  dismissToast(id) {
    const tm = toastTimers.get(id);
    if (tm) {
      clearTimeout(tm);
      toastTimers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  /** shared by online (socket) and local (engine) game updates:
   * sounds, toasts, and state swap */
  ingestGameState(game) {
    const s = get();
    const prev = s.game;
    const isMyTurn =
      game.players[game.turn]?.id === game.yourId && !game.winner && !game.stalemate;

    const maxLogN = Math.max(0, ...(game.log ?? []).map((e) => e.n));
    const baseline = maxLogN < s.lastEventSeen ? 0 : s.lastEventSeen;
    const newEvents = (game.log ?? []).filter((e) => e.n > baseline);
    for (const e of newEvents) {
      const mine = e.playerId === game.yourId;
      if (e.kind === 'place') {
        sfx.place();
        if (e.newSequences && e.newSequences.length > 0) {
          sfx.sequence();
          get().toast(`${mine ? 'You' : e.playerName} completed a SEQUENCE!`, 'gold');
        }
      } else if (e.kind === 'remove') {
        sfx.remove();
        get().toast(
          `${mine ? 'You' : e.playerName} played a one-eyed Jack and removed a chip`,
          mine ? 'info' : 'error',
        );
      } else if (e.kind === 'exchangeDead') {
        if (!mine) get().toast(`${e.playerName} exchanged a dead card`);
      } else if (e.kind === 'swapDead') {
        const n = e.swapped ?? 0;
        get().toast(
          `${mine ? 'You' : e.playerName} refreshed ${n} dead card${n === 1 ? '' : 's'}`,
        );
      } else if (e.kind === 'forfeitDraw') {
        get().toast(
          mine
            ? 'You forgot to draw, card forfeited!'
            : `${e.playerName} forgot to draw and forfeited a card`,
          mine ? 'error' : 'info',
        );
      } else if (e.kind === 'pass') {
        get().toast(`${mine ? 'You' : e.playerName} had no legal move and passed`);
      }
    }

    const over = game.winner || game.stalemate;
    const wasOver = prev?.winner || prev?.stalemate;
    const myTeam = game.players.find((p) => p.id === game.yourId)?.team;
    if (over && !wasOver) {
      if (game.winner && myTeam === game.winner) sfx.win();
      else sfx.lose();
      // Record win/loss stats (players only, not spectators; skip pure draws as
      // neither). Pass & Play on one device is excluded: the "viewer" is always
      // whoever just moved, so every finished game would score as a win.
      const sharedDevice = s.mode === 'local' && s.localSeats.filter((x) => !x.isBot).length > 1;
      if (!game.spectator && myTeam && !sharedDevice) {
        const won = game.winner === myTeam;
        const st = get().stats;
        const stats: Stats = {
          games: st.games + 1,
          wins: st.wins + (won ? 1 : 0),
          losses: st.losses + (game.winner && !won ? 1 : 0),
        };
        LS.set('seq:stats', JSON.stringify(stats));
        set({ stats });
      }
    } else if (isMyTurn && !s.wasMyTurn) {
      sfx.yourTurn();
      notifyMyTurn(get().prefs.notifyTurn);
    }

    set({
      game,
      view: 'game',
      lastEventSeen: Math.max(baseline, maxLogN),
      wasMyTurn: isMyTurn,
      selectedCard:
        s.selectedCard && game.yourHand.includes(s.selectedCard) ? s.selectedCard : null,
    });
  },

  init() {
    // Online multiplayer is peer-to-peer (WebRTC) and established on demand when
    // a room is created or joined, nothing to connect up front. Pass & Play and
    // vs-computer are fully local.
  },

  netHandlers(): NetHandlers {
    return {
      onRoomUpdate: (room) => {
        if (get().mode !== 'online') return;
        set((s) => ({
          room,
          view: room.started && s.game ? 'game' : room.started ? s.view : 'lobby',
        }));
        // if the host changed the room board ("for everyone"), re-sync every
        // client, clearing any personal override so it truly applies to all
        const rt = room.settings?.boardTheme;
        if (rt !== lastRoomTheme) {
          lastRoomTheme = rt;
          boardOverridden = false;
        }
        applyBoardTheme(rt, get().prefs.boardTheme);
      },
      onGameState: (g) => {
        if (get().mode !== 'online') return;
        set({ spectating: !!g.spectator });
        get().ingestGameState(g);
      },
      onChat: (m) => {
        const msg = { ...m, ts: m.ts || Date.now() };
        if (msg.playerId !== get().playerId) sfx.chat();
        set((s) => ({ chat: [...s.chat.slice(-99), msg] }));
      },
      onEmote: (m) => {
        if (m.playerId !== get().playerId) sfx.emote();
        const fe: FloatingEmote = { id: ++emoteId, emote: m.emote, name: m.name, team: m.team };
        set((s) => ({ emotes: [...s.emotes, fe] }));
        setTimeout(() => set((s) => ({ emotes: s.emotes.filter((e) => e.id !== fe.id) })), 2600);
      },
      onError: (msg) => {
        sfx.error();
        get().toast(msg, 'error');
        // a failed create/join leaves us on home
        if (!get().room && !get().game) get()._goHome();
      },
      onKicked: () => {
        get().toast('You were removed from the room', 'error');
        get()._goHome();
      },
      onJoined: (_code, spectator) => set({ spectating: spectator }),
      onNotice: (text) => {
        if (text) get().toast(text, 'info');
      },
      onClosed: (reason) => {
        get().toast(reason, 'error');
        get()._goHome();
      },
      onBecomeHost: (code, snap) => {
        // the host left and we're the heir, take over hosting on the same code
        const { name, playerId, prefs } = get();
        const host = new NetHost(
          playerId,
          name || 'Player',
          prefs.avatar,
          get().netHandlers(),
          { code, snap },
        );
        set({ net: host, netKind: 'host' });
        get().toast("The host left, you're hosting now, game continues.", 'gold');
      },
    };
  },

  _goHome() {
    const s = get();
    // leaving the table: forget the room board so your own theme applies again
    boardOverridden = false;
    lastRoomTheme = undefined;
    applyBoardTheme(undefined, s.prefs.boardTheme);
    if (s.net) {
      try {
        s.net.destroy();
      } catch {
        /* ignore */
      }
    }
    // stop the local game loop, otherwise bots keep playing in the background
    if (s.localBotTimer) clearTimeout(s.localBotTimer);
    set({
      net: null,
      netKind: null,
      room: null,
      game: null,
      view: 'home',
      chat: [],
      mode: 'online',
      spectating: false,
      wasMyTurn: false,
      lastEventSeen: 0,
      selectedCard: null,
      hint: null,
      localCore: null,
      localSeats: [],
      localViewer: null,
      localBotTimer: null,
      handoffName: null,
      localUndo: null,
      // an unfinished local game stays resumable from Home
      savedLocal: loadLocalGame(),
    });
  },

  setName(n) {
    LS.set('seq:name', n);
    set({ name: n });
  },

  setPref(key, value) {
    // changing your own board theme is a personal override that beats the room's
    // shared board, until the host next changes the board for everyone
    if (key === 'boardTheme') boardOverridden = true;
    const prefs = { ...get().prefs, [key]: value };
    LS.set('seq:prefs', JSON.stringify(prefs));
    applyPrefs(prefs, get().room?.settings?.boardTheme);
    set({ prefs });
  },

  createRoom() {
    const { name, playerId, prefs } = get();
    get()._goHome();
    const host = new NetHost(playerId, name || 'Player', prefs.avatar, get().netHandlers());
    set({ net: host, netKind: 'host', mode: 'online', chat: [], lastEventSeen: 0, wasMyTurn: false });
  },

  quickPlay(players) {
    // vs-computer runs entirely on the client engine (no server needed), so it
    // works on a static deploy and offline
    const { name } = get();
    const n = [2, 3, 4, 6].includes(players) ? players : 2;
    const seats: LocalSeat[] = [{ name: name || 'Player', isBot: false }];
    for (let i = 1; i < n; i++) seats.push({ name: '', isBot: true });
    get().startLocal(seats);
  },

  joinRoom(code, password) {
    const { name, playerId, prefs } = get();
    get()._goHome();
    const guest = new NetGuest(
      code.trim().toUpperCase(),
      playerId,
      name || 'Player',
      prefs.avatar,
      false,
      get().netHandlers(),
      password ?? '',
    );
    set({ net: guest, netKind: 'guest', mode: 'online', chat: [], lastEventSeen: 0, wasMyTurn: false });
    get().toast('Connecting to room…');
  },

  spectate(code, password) {
    const { name, playerId, prefs } = get();
    get()._goHome();
    const guest = new NetGuest(
      code.trim().toUpperCase(),
      playerId,
      name || 'Guest',
      prefs.avatar,
      true,
      get().netHandlers(),
      password ?? '',
    );
    set({ net: guest, netKind: 'guest', mode: 'online', chat: [], lastEventSeen: 0, wasMyTurn: false });
    get().toast('Connecting to watch…');
  },

  leaveRoom() {
    const s = get();
    if (s.mode === 'local') {
      if (s.localBotTimer) clearTimeout(s.localBotTimer);
      set({
        mode: 'online',
        localCore: null,
        localViewer: null,
        handoffName: null,
        localBotTimer: null,
        game: null,
        view: 'home',
        selectedCard: null,
        lastEventSeen: 0,
        wasMyTurn: false,
      });
      return;
    }
    get()._goHome();
  },

  addBot() {
    const { net, netKind } = get();
    if (netKind === 'host') (net as NetHost).addBot();
  },
  removePlayer(id) {
    const { net, netKind } = get();
    if (netKind === 'host') (net as NetHost).removePlayer(id);
  },
  updateSettings(cfg) {
    const { net, netKind } = get();
    if (netKind === 'host') (net as NetHost).updateSettings(cfg);
  },
  startGame() {
    const { net, netKind } = get();
    if (netKind === 'host') {
      const err = (net as NetHost).start();
      if (err) get().toast(err, 'error');
    }
  },
  sendEmote(emote) {
    const { net, netKind } = get();
    if (netKind === 'host') (net as NetHost).emoteLocal(emote);
    else if (netKind === 'guest') (net as NetGuest).send({ t: 'emote', emote });
  },
  requestUndo() {
    const s = get();
    // on-device games take the move back immediately, there's nobody to ask
    if (s.mode === 'local') {
      if ((s.localCore?.settings.undoMode ?? 'approval') === 'off') {
        get().toast('Undo is turned off for this game.', 'info');
        return;
      }
      if (!s.localUndo) {
        get().toast('Nothing to take back.', 'info');
        return;
      }
      if (s.localBotTimer) clearTimeout(s.localBotTimer);
      const core = JSON.parse(s.localUndo) as GameCore;
      core.rng = Math.random;
      set({
        localCore: core,
        localUndo: null,
        localBotTimer: null,
        hint: null,
        selectedCard: null,
        handoffName: null,
        lastEventSeen: core.eventCounter ?? 0,
      });
      get().localTick();
      get().toast('Move taken back');
      return;
    }
    if (s.netKind === 'host') (s.net as NetHost).requestUndoLocal();
    else if (s.netKind === 'guest') (s.net as NetGuest).send({ t: 'undoReq' });
  },
  respondUndo(approve) {
    const { net, netKind } = get();
    if (netKind === 'host') (net as NetHost).respondUndoLocal(approve);
    else if (netKind === 'guest') (net as NetGuest).send({ t: 'undoResp', approve });
  },

  playMove(move) {
    const s = get();
    if (s.hint) set({ hint: null });
    if (s.mode === 'local') {
      const core = s.localCore;
      if (!core || s.handoffName) return;
      const cur = core.players[core.turn];
      if (!cur || cur.isBot || cur.id !== s.localViewer) return;
      // snapshot before mutating so this move can be taken back on-device
      const before = JSON.stringify(core);
      const res = applyMove(core, cur.id, move);
      if (!res.ok) {
        sfx.error();
        get().toast(res.error ?? 'Illegal move.', 'error');
        return;
      }
      set({ localUndo: before });
      get().localTick();
      return;
    }
    if (s.netKind === 'host') (s.net as NetHost).localMove(move);
    else if (s.netKind === 'guest') (s.net as NetGuest).send({ t: 'move', move });
  },

  rematch() {
    const s = get();
    if (s.mode === 'local') {
      const rotated = [...s.localSeats.slice(1), s.localSeats[0]];
      get().startLocal(rotated);
      return;
    }
    if (s.netKind === 'host') {
      set({ lastEventSeen: 0 });
      const err = (s.net as NetHost).rematch();
      if (err) get().toast(err, 'error');
    }
  },

  sendChat(text) {
    const { net, netKind } = get();
    if (netKind === 'host') (net as NetHost).chatLocal(text);
    else if (netKind === 'guest') (net as NetGuest).send({ t: 'chat', text });
  },

  selectCard(card) {
    if (card) sfx.select();
    set({ selectedCard: card, hint: null, previewCard: null });
  },

  previewCardSet(card) {
    set({ previewCard: card });
  },

  setReady(v) {
    const s = get();
    if (s.netKind === 'guest') (s.net as NetGuest).ready(v);
    else if (s.netKind === 'host') {
      const h = s.net as NetHost;
      const me = h.players.find((p) => p.id === s.playerId);
      if (me) me.ready = v;
      h.pushRoomPublic();
    }
  },

  requestHint() {
    const announceHint = () => {
      const s2 = get();
      if (s2.netKind === 'guest') (s2.net as NetGuest).hintUsed();
      else if (s2.netKind === 'host') (s2.net as NetHost).announceHint(s2.playerId);
      // on one device everyone is looking at the same screen, so the marker
      // itself is the announcement
    };
    const g = get().game;
    if (!g) return;
    if (g.settings.hints !== true) {
      get().toast('Hints are turned off for this game.', 'info');
      return;
    }
    const me = g.players.find((p) => p.id === g.yourId);
    const myTurn = !g.winner && !g.stalemate && g.players[g.turn]?.id === g.yourId;
    if (!me || !myTurn) {
      get().toast('Hints are for your turn.', 'info');
      return;
    }
    // chooseBotMove only reads board/settings/deadExchangedThisTurn + the player's
    // own hand/team, so a light shim of the client state is enough to score moves.
    const shim = {
      board: g.board,
      layout: g.layout,
      settings: g.settings,
      deadExchangedThisTurn: g.deadExchangedThisTurn,
    } as unknown as GameCore;
    const mePlayer = {
      id: g.yourId,
      name: me.name,
      team: me.team,
      isBot: false,
      hand: [...g.yourHand],
      connected: true,
    } as unknown as ServerPlayer;
    const move = chooseBotMove(shim, mePlayer, 'hard');
    // hints are worked out on this device, so the table only learns about one
    // if we announce it
    announceHint();
    if (move.type === 'place' || move.type === 'remove') {
      sfx.select();
      set({
        selectedCard: move.card,
        hint: { card: move.card, r: move.r, c: move.c, turn: g.turn },
      });
      get().toast(
        move.type === 'remove' ? 'Hint: remove the marked chip ✦' : 'Hint: play the marked space ✦',
        'info',
      );
    } else if (move.type === 'exchangeDead') {
      set({ selectedCard: move.card, hint: null });
      get().toast('Hint: exchange your dead card', 'info');
    } else {
      set({ hint: null });
      get().toast('No legal move, you can pass.', 'info');
    }
  },

  // ---------- local pass-and-play ----------

  resumeLocal() {
    const saved = get().savedLocal;
    if (!saved) return;
    const s = get();
    if (s.localBotTimer) clearTimeout(s.localBotTimer);
    // a local game must not leave an online transport running
    if (s.net) {
      try {
        s.net.destroy();
      } catch {
        /* ignore */
      }
    }
    set({
      net: null,
      netKind: null,
      mode: 'local',
      localCore: saved.core,
      localSeats: saved.seats,
      localViewer: saved.viewer,
      handoffName: null,
      localBotTimer: null,
      room: null,
      chat: [],
      game: null,
      // start from the saved event counter so resuming doesn't replay the whole
      // move log as a burst of sounds and toasts
      lastEventSeen: saved.core.eventCounter ?? 0,
      wasMyTurn: false,
      view: 'game',
      savedLocal: null,
      localUndo: null,
      hint: null,
      selectedCard: null,
    });
    get().localTick();
  },

  startLocal(seats) {
    const s = get();
    if (s.localBotTimer) clearTimeout(s.localBotTimer);
    // a local game must not leave an online transport running
    if (s.net) {
      try {
        s.net.destroy();
      } catch {
        /* ignore */
      }
    }
    const n = seats.length;
    const teamCount: 2 | 3 = n === 3 ? 3 : 2;
    const core = createGame(
      seats.map((seat, i) => ({
        id: `L${i}`,
        name: seat.name.trim() || (seat.isBot ? `Bot ${i + 1}` : `Player ${i + 1}`),
        isBot: seat.isBot,
        team: TEAMS[i % teamCount],
      })),
      defaultSettings({ teamCount, botDifficulty: get().prefs.difficulty }),
    );
    const firstHuman = core.players.find((p) => !p.isBot);
    const starter = core.players[core.turn];
    set({
      mode: 'local',
      localCore: core,
      localSeats: seats,
      localViewer: (!starter.isBot ? starter.id : firstHuman?.id) ?? core.players[0].id,
      handoffName: null,
      localBotTimer: null,
      room: null,
      chat: [],
      game: null,
      lastEventSeen: 0,
      wasMyTurn: false,
      view: 'game',
      savedLocal: null,
      localUndo: null,
    });
    get().localTick();
  },

  confirmHandoff() {
    const core = get().localCore;
    if (!core) return;
    const cur = core.players[core.turn];
    if (!cur || cur.isBot) return;
    set({ localViewer: cur.id, handoffName: null });
    get().ingestGameState(toClientState(core, cur.id));
  },

  localTick() {
    const s = get();
    const core = s.localCore;
    if (!core) return;
    const over = !!core.winner || core.stalemate;
    const cur = core.players[core.turn];
    let handoffName: string | null = null;
    if (!over && cur && !cur.isBot && cur.id !== s.localViewer) {
      handoffName = cur.name; // hide the next player's hand until they tap
    }
    // while a handoff is pending, view the board as a non-player so NO hand is
    // ever exposed under the overlay (prevents peeking at the last player's hand)
    const viewer = handoffName
      ? '__handoff__'
      : (s.localViewer ?? core.players.find((p) => !p.isBot)?.id ?? core.players[0].id);
    get().ingestGameState(toClientState(core, viewer));
    set({ handoffName });
    // checkpoint after every move so a refresh resumes exactly here
    saveLocalGame(core, s.localSeats, s.localViewer);

    if (!over && cur?.isBot && !get().localBotTimer) {
      const timer = window.setTimeout(() => {
        set({ localBotTimer: null });
        const c = get().localCore;
        if (!c || c.winner || c.stalemate) return;
        const p = c.players[c.turn];
        if (!p?.isBot) return;
        const mv = chooseBotMove(c, p);
        const res = applyMove(c, p.id, mv);
        if (!res.ok) {
          // failsafe: a guaranteed-legal move, then pass, never leave it stuck
          const forced = forceLegalMove(c, p);
          if (!applyMove(c, p.id, forced).ok) applyMove(c, p.id, { type: 'pass' });
        }
        get().localTick();
      }, 750 + Math.random() * 750);
      set({ localBotTimer: timer });
    }
  },
}));

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__seq = useStore;
}
