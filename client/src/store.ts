import { io, type Socket } from 'socket.io-client';
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
} from '../../shared/types';
import { TEAMS } from '../../shared/types';
import { setHaptics, setMuted, sfx } from './sounds';

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
  haptics: boolean;
  colorblind: boolean;
  avatar: string;
  difficulty: BotDifficulty;
}

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
export const EMOTES = ['👍', '😂', '😮', '🔥', '😎', '😭', '🎉', '🤔', '❤️', '🍀'];

let toastId = 0;
let emoteId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** localStorage throws in some privacy modes / insecure contexts — never let
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
    haptics: saved.haptics ?? true,
    colorblind: saved.colorblind ?? false,
    avatar: saved.avatar ?? AVATARS[0],
    difficulty: saved.difficulty ?? 'medium',
  };
}

function loadStats(): Stats {
  try {
    const s = JSON.parse(LS.get('seq:stats') ?? '{}');
    return { wins: s.wins ?? 0, losses: s.losses ?? 0, games: s.games ?? 0 };
  } catch {
    return { wins: 0, losses: 0, games: 0 };
  }
}

/** Apply prefs that have global side effects (sound engine, colorblind body class). */
function applyPrefs(p: Prefs) {
  setMuted(!p.sound);
  setHaptics(p.haptics);
  try {
    document.body.classList.toggle('colorblind', p.colorblind);
  } catch {
    /* SSR/no-dom */
  }
}

function getPlayerId(): string {
  let id = LS.get('seq:playerId');
  if (!id) {
    id = makeId();
    LS.set('seq:playerId', id);
  }
  return id;
}

interface Store {
  socket: Socket | null;
  connected: boolean;
  /** true once we've either connected or given up probing — used to stop
   * showing "Connecting…" forever on a static (serverless) deploy */
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
  rejoining: boolean;
  lastEventSeen: number;
  wasMyTurn: boolean;

  prefs: Prefs;
  stats: Stats;
  emotes: FloatingEmote[];
  spectating: boolean;

  // local pass-and-play
  localCore: GameCore | null;
  localSeats: LocalSeat[];
  localViewer: string | null;
  handoffName: string | null;
  localBotTimer: number | null;

  init: () => void;
  setName: (n: string) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  createRoom: () => void;
  quickPlay: (players: number) => void;
  joinRoom: (code: string) => void;
  spectate: (code: string) => void;
  leaveRoom: () => void;
  addBot: () => void;
  removePlayer: (id: string) => void;
  updateSettings: (s: {
    teamCount?: number;
    strictDraw?: boolean;
    botDifficulty?: BotDifficulty;
    turnSeconds?: number;
  }) => void;
  startGame: () => void;
  playMove: (move: Move) => void;
  rematch: () => void;
  sendChat: (text: string) => void;
  sendEmote: (emote: string) => void;
  requestUndo: () => void;
  respondUndo: (approve: boolean) => void;
  selectCard: (card: Card | null) => void;
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
  socket: null,
  connected: false,
  serverProbed: false,
  view: 'home',
  mode: 'online',
  name: LS.get('seq:name') ?? '',
  playerId: getPlayerId(),
  room: null,
  game: null,
  chat: [],
  toasts: [],
  selectedCard: null,
  rejoining: false,
  lastEventSeen: 0,
  wasMyTurn: false,

  prefs: initialPrefs,
  stats: loadStats(),
  emotes: [],
  spectating: false,

  localCore: null,
  localSeats: [],
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
      } else if (e.kind === 'forfeitDraw') {
        get().toast(
          mine
            ? 'You forgot to draw — card forfeited!'
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
      // record win/loss stats (players only, not spectators; skip pure draws as neither)
      if (!game.spectator && myTeam) {
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
    if (get().socket) return;
    const socket = io({ transports: ['websocket', 'polling'] });
    set({ socket });

    // if no server answers within a few seconds (e.g. a static GitHub Pages
    // deploy with no backend), stop showing "Connecting…" and settle into
    // offline mode where vs-computer and Pass & Play still work
    setTimeout(() => set({ serverProbed: true }), 4500);

    socket.on('connect', () => {
      set({ connected: true, serverProbed: true });
      const lastRoom = LS.get('seq:lastRoom');
      if (lastRoom && !get().room && get().mode === 'online') {
        set({ rejoining: true });
        socket.emit('joinRoom', {
          code: lastRoom,
          name: get().name || 'Player',
          playerId: get().playerId,
          token: LS.get('seq:token') ?? '',
        });
      }
    });

    socket.on('disconnect', () => set({ connected: false }));

    socket.on('roomJoined', ({ code, token }: { code: string; token?: string }) => {
      LS.set('seq:lastRoom', code);
      if (token) LS.set('seq:token', token);
      set({ rejoining: false });
    });

    // another tab/device took over this player's session
    socket.on('sessionMoved', () => {
      LS.remove('seq:lastRoom');
      set({ room: null, game: null, view: 'home', chat: [], mode: 'online' });
      get().toast('Your session was opened in another tab.', 'info');
    });

    socket.on('roomUpdate', (room: RoomInfo) => {
      if (get().mode === 'local') return;
      const started = room.started;
      set((s) => ({
        room,
        view: started && s.game ? 'game' : started ? s.view : 'lobby',
      }));
    });

    socket.on('gameState', (game: ClientGameState) => {
      if (get().mode === 'local') return;
      set({ spectating: !!game.spectator });
      get().ingestGameState(game);
    });

    socket.on('chat', (msg: ChatMessage) => {
      if (msg.playerId !== get().playerId) sfx.chat();
      set((s) => ({ chat: [...s.chat.slice(-99), msg] }));
    });

    socket.on('emote', (msg: EmoteMessage) => {
      if (msg.playerId !== get().playerId) sfx.emote();
      const fe: FloatingEmote = {
        id: ++emoteId,
        emote: msg.emote,
        name: msg.name,
        team: msg.team,
      };
      set((s) => ({ emotes: [...s.emotes, fe] }));
      setTimeout(() => set((s) => ({ emotes: s.emotes.filter((e) => e.id !== fe.id) })), 2600);
    });

    socket.on('spectating', () => {
      set({ spectating: true, mode: 'online' });
    });

    socket.on('errorMsg', (message: string) => {
      if (get().rejoining) {
        LS.remove('seq:lastRoom');
        set({ rejoining: false });
        return;
      }
      sfx.error();
      get().toast(message, 'error');
    });

    socket.on('kicked', () => {
      LS.remove('seq:lastRoom');
      set({
        room: null,
        game: null,
        view: 'home',
        chat: [],
        wasMyTurn: false,
        lastEventSeen: 0,
      });
      get().toast('You were removed from the room', 'error');
    });
  },

  setName(n) {
    LS.set('seq:name', n);
    set({ name: n });
  },

  setPref(key, value) {
    const prefs = { ...get().prefs, [key]: value };
    LS.set('seq:prefs', JSON.stringify(prefs));
    applyPrefs(prefs);
    set({ prefs });
  },

  createRoom() {
    const { socket, name, playerId, prefs } = get();
    socket?.emit('createRoom', { name: name || 'Player', playerId, avatar: prefs.avatar });
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

  joinRoom(code) {
    const { socket, name, playerId, prefs } = get();
    socket?.emit('joinRoom', {
      code: code.trim().toUpperCase(),
      name: name || 'Player',
      playerId,
      token: LS.get('seq:token') ?? '',
      avatar: prefs.avatar,
    });
  },

  spectate(code) {
    const { socket, name, playerId } = get();
    set({ lastEventSeen: 0, wasMyTurn: false, game: null });
    socket?.emit('joinSpectate', { code: code.trim().toUpperCase(), name: name || 'Guest', playerId });
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
    s.socket?.emit('leaveRoom');
    LS.remove('seq:lastRoom');
    set({
      room: null,
      game: null,
      view: 'home',
      chat: [],
      selectedCard: null,
      lastEventSeen: 0,
      wasMyTurn: false,
      spectating: false,
    });
  },

  addBot: () => get().socket?.emit('addBot'),
  removePlayer: (id) => get().socket?.emit('removePlayer', { id }),
  updateSettings: (s) => get().socket?.emit('updateSettings', s),
  startGame: () => get().socket?.emit('startGame'),
  sendEmote: (emote) => get().socket?.emit('emote', { emote }),
  requestUndo: () => get().socket?.emit('requestUndo'),
  respondUndo: (approve) => get().socket?.emit('respondUndo', { approve }),

  playMove(move) {
    const s = get();
    if (s.mode === 'local') {
      const core = s.localCore;
      if (!core || s.handoffName) return;
      const cur = core.players[core.turn];
      if (!cur || cur.isBot || cur.id !== s.localViewer) return;
      const res = applyMove(core, cur.id, move);
      if (!res.ok) {
        sfx.error();
        get().toast(res.error ?? 'Illegal move.', 'error');
        return;
      }
      get().localTick();
      return;
    }
    s.socket?.emit('playMove', move);
  },

  rematch() {
    const s = get();
    if (s.mode === 'local') {
      const rotated = [...s.localSeats.slice(1), s.localSeats[0]];
      get().startLocal(rotated);
      return;
    }
    set({ lastEventSeen: 0 });
    s.socket?.emit('rematch');
  },

  sendChat: (text) => get().socket?.emit('chat', { text }),

  selectCard(card) {
    if (card) sfx.select();
    set({ selectedCard: card });
  },

  // ---------- local pass-and-play ----------

  startLocal(seats) {
    const s = get();
    if (s.localBotTimer) clearTimeout(s.localBotTimer);
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
          // failsafe: a guaranteed-legal move, then pass — never leave it stuck
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
