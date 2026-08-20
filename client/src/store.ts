import { create } from 'zustand';
import { type BotPersonality, PERSONALITIES, chooseBotMove } from '../../shared/bot';
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
  GameSettings,
  Move,
  RoomInfo,
  ServerPlayer,
  Team,
} from '../../shared/types';
import { TEAMS } from '../../shared/types';
import { cleanSeed, dailySeed, makeSeed, seededRng } from '../../shared/rng';
import type { NetGuest, NetHost, NetHandlers } from './net';
import { setHaptics, setMuted, setVolume, sfx } from './sounds';

/** The multiplayer transport pulls in mqtt (~370KB), which solo/local play never
 * needs. Load net.ts on demand the first time someone hosts, joins, or watches a
 * room, and cache the module so later calls (e.g. host migration) are instant. */
let NetMod: typeof import('./net') | null = null;
async function loadNet(): Promise<typeof import('./net')> {
  if (!NetMod) NetMod = await import('./net');
  return NetMod;
}

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
  /** challenge level: 'normal' shows legal spaces and lets you use hints;
   * 'hard' highlights nothing and hides the hint, you find the space yourself */
  gameLevel: 'normal' | 'hard';
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
  { id: 'sakura', label: '🌸 Sakura' },
  { id: 'neon', label: '⚡ Neon Grid' },
  { id: 'love', label: '💕 Love' },
];

export interface Stats {
  wins: number;
  losses: number;
  games: number;
  /** current win streak */
  streak: number;
  /** best win streak ever */
  bestStreak: number;
}

/** An unlockable achievement. `test` runs at game-over with the finished game,
 * the (already updated) stats, and some context, and returns true when earned. */
export interface Achievement {
  id: string;
  label: string;
  desc: string;
  emoji: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', label: 'First Blood', desc: 'Win your first game', emoji: '🩸' },
  { id: 'streak_3', label: 'On a Roll', desc: 'Win 3 games in a row', emoji: '🔥' },
  { id: 'streak_5', label: 'Unstoppable', desc: 'Win 5 games in a row', emoji: '⚡' },
  { id: 'shutout', label: 'Shutout', desc: 'Win without the other team scoring a sequence', emoji: '🧱' },
  { id: 'double', label: 'Double Up', desc: 'Win a game with 2 sequences', emoji: '✌️' },
  { id: 'hard_win', label: 'Giant Slayer', desc: 'Beat a Hard bot', emoji: '🗡️' },
  { id: 'daily_win', label: 'Daily Grind', desc: 'Win a daily challenge', emoji: '🎯' },
  { id: 'blitz_win', label: 'Speed Demon', desc: 'Win a Blitz game', emoji: '💨' },
  { id: 'marathon_win', label: 'Marathoner', desc: 'Win a Marathon (3 sequences)', emoji: '🏔️' },
  { id: 'series_win', label: 'Champion', desc: 'Win a best-of match', emoji: '🏆' },
  { id: 'games_10', label: 'Regular', desc: 'Play 10 games', emoji: '🎲' },
  { id: 'veteran', label: 'Veteran', desc: 'Win 25 games', emoji: '🎖️' },
];

/** XP and level from lifetime progress. Levels get gently harder to reach. */
export function xpForStats(stats: Stats, achievements: string[]): number {
  return stats.wins * 10 + stats.games * 2 + achievements.length * 20;
}
export function levelForXp(xp: number): { level: number; into: number; span: number } {
  // each level N needs 50*N more xp than the last (cumulative quadratic-ish)
  let level = 1;
  let need = 50;
  let acc = 0;
  while (xp >= acc + need) {
    acc += need;
    level++;
    need = 50 * level;
  }
  return { level, into: xp - acc, span: need };
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
    gameLevel: saved.gameLevel ?? 'normal',
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
  /** the deal's shareable seed, kept so a resumed game still shows/shares it */
  seed?: string | null;
  /** each bot's personality, kept so a resumed game keeps the same opponents */
  persona?: Record<string, BotPersonality>;
}

/** Persist an in-progress solo / pass-and-play game so a refresh doesn't lose it.
 * JSON.stringify drops the core's `rng` function; it's restored on load (the deck
 * order is already fixed in the saved state, so play continues identically). */
function saveLocalGame(
  core: GameCore,
  seats: LocalSeat[],
  viewer: string | null,
  seed: string | null,
  persona: Record<string, BotPersonality>,
) {
  try {
    if (core.winner || core.stalemate) {
      LS.remove(LOCAL_GAME_KEY);
      return;
    }
    LS.set(LOCAL_GAME_KEY, JSON.stringify({ core, seats, viewer, seed, persona }));
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
    return {
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      games: s.games ?? 0,
      streak: s.streak ?? 0,
      bestStreak: s.bestStreak ?? 0,
    };
  } catch {
    return { wins: 0, losses: 0, games: 0, streak: 0, bestStreak: 0 };
  }
}

function loadAchievements(): string[] {
  try {
    const a = JSON.parse(LS.get('seq:achievements') ?? '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

const DAILY_KEY = 'seq:daily';

/** Your result on a given day's challenge, kept so Home can show today's status. */
export interface DailyResult {
  seed: string;
  won: boolean;
  moves: number;
}

function loadDaily(): DailyResult | null {
  try {
    const d = JSON.parse(LS.get(DAILY_KEY) ?? 'null');
    return d && typeof d.seed === 'string' ? d : null;
  } catch {
    return null;
  }
}

/** Board-theme precedence, so both "change mine" and "change for everyone" work:
 *  - the room's board (host's "for everyone" pick) is the shared default;
 *  - a player can override it just for themselves ("change mine");
 *  - but when the host changes the room board again, that re-syncs everyone,
 *    clearing personal overrides, so "everyone's board changes" really happens.
 * We detect a host change by the room theme value changing. */
let boardOverridden = false;
let lastBoardEpoch = 0;

function applyBoardTheme(roomTheme: string | undefined, prefTheme: string): string {
  const theme = (boardOverridden ? prefTheme : roomTheme || prefTheme) || 'classic';
  try {
    document.body.dataset.board = theme;
  } catch {
    /* SSR/no-dom */
  }
  return theme;
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
function readInvite(): { code: string | null; watch: boolean } {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('r') ?? '').trim().toUpperCase();
    // a spectator link carries &w=1, so the join field defaults to watch mode
    const watch = params.get('w') === '1';
    if (!/^[A-Z0-9]{5}$/.test(raw)) return { code: null, watch: false };
    params.delete('r');
    params.delete('w');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    return { code: raw, watch };
  } catch {
    return { code: null, watch: false };
  }
}
const INVITE = readInvite();
const INVITE_CODE = INVITE.code;

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
  /** an invite link asked to watch (spectate) rather than join */
  pendingWatch: boolean;
  rejoining: boolean;
  lastEventSeen: number;
  wasMyTurn: boolean;

  prefs: Prefs;
  /** the board theme actually on screen right now (room default, or your override) */
  boardView: string;
  stats: Stats;
  /** unlocked achievement ids */
  achievements: string[];
  /** your result on today's daily challenge, or null if not played today */
  dailyResult: DailyResult | null;
  emotes: FloatingEmote[];
  spectating: boolean;

  /** an in-progress solo/pass-and-play game recovered from a previous session */
  savedLocal: SavedLocal | null;
  resumeLocal: () => void;

  // local pass-and-play
  localCore: GameCore | null;
  localSeats: LocalSeat[];
  localViewer: string | null;
  /** the shareable seed of the current local deal (null for online games) */
  localSeed: string | null;
  /** each local bot's personality, keyed by player id (Lx) */
  localBotPersona: Record<string, BotPersonality>;
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
  /** flag this player busy/back when the app is backgrounded/foregrounded */
  setAway: (away: boolean) => void;
  /** true once the browser has offered its install prompt (Android/desktop Chrome) */
  installReady: boolean;
  /** show the browser's install-app prompt (captured from beforeinstallprompt) */
  promptInstall: () => void;
  setReady: (v: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  ingestGameState: (game: ClientGameState) => void;

  startLocal: (
    seats: LocalSeat[],
    opts?: {
      seed?: string;
      daily?: boolean;
      settings?: Partial<GameSettings>;
      series?: number;
      keepSeries?: boolean;
    },
  ) => void;
  /** start today's daily challenge: a fixed deal shared by everyone that day */
  startDaily: () => void;
  /** start a local game from a pasted/typed seed code (you vs one bot) */
  startSeed: (code: string) => void;
  /** best-of match: how many game wins are needed (1 = single game) */
  seriesTarget: number;
  /** game wins per team in the current local match */
  seriesWins: Record<Team, number>;
  /** deal the next game of an ongoing local match (keeps the running score) */
  nextSeriesGame: () => void;
  /** change the bots' difficulty mid-game in a local match */
  setLocalBotDifficulty: (d: BotDifficulty) => void;
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
  pendingWatch: INVITE.watch,
  rejoining: false,
  lastEventSeen: 0,
  wasMyTurn: false,

  prefs: initialPrefs,
  boardView: initialPrefs.boardTheme,
  stats: loadStats(),
  achievements: loadAchievements(),
  dailyResult: loadDaily(),
  seriesTarget: 1,
  seriesWins: { red: 0, blue: 0, green: 0 },
  emotes: [],
  spectating: false,

  savedLocal: loadLocalGame(),
  localCore: null,
  localSeats: [],
  localSeed: null,
  localBotPersona: {},
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
      const won = game.winner === myTeam;
      if (!game.spectator && myTeam && !sharedDevice) {
        const st = get().stats;
        const stats: Stats = {
          games: st.games + 1,
          wins: st.wins + (won ? 1 : 0),
          losses: st.losses + (game.winner && !won ? 1 : 0),
          streak: won ? st.streak + 1 : 0,
          bestStreak: Math.max(st.bestStreak, won ? st.streak + 1 : 0),
        };
        LS.set('seq:stats', JSON.stringify(stats));
        set({ stats });

        // evaluate achievements against this finished game
        const isDaily = s.mode === 'local' && s.localSeed === dailySeed();
        const seriesDecided =
          s.mode === 'local' && s.seriesTarget > 1 && (s.seriesWins[myTeam] ?? 0) + 1 >= s.seriesTarget;
        const oppSeqs = game.sequences.filter((q) => q.team !== myTeam).length;
        const mySeqs = game.sequences.filter((q) => q.team === myTeam).length;
        const vsHardBot =
          s.mode === 'local' &&
          game.settings.botDifficulty === 'hard' &&
          game.players.some((p) => p.isBot);
        const ts = game.settings.turnSeconds ?? 0;
        const winReq = game.settings.winSequences ?? 0;
        const earned: Record<string, boolean> = {
          first_win: won,
          streak_3: stats.streak >= 3,
          streak_5: stats.streak >= 5,
          shutout: won && oppSeqs === 0,
          double: won && mySeqs >= 2,
          hard_win: won && vsHardBot,
          daily_win: won && isDaily,
          blitz_win: won && ts > 0 && ts <= 20,
          marathon_win: won && winReq >= 3,
          series_win: won && seriesDecided,
          games_10: stats.games >= 10,
          veteran: stats.wins >= 25,
        };
        const have = get().achievements;
        const fresh = ACHIEVEMENTS.filter((a) => earned[a.id] && !have.includes(a.id));
        if (fresh.length) {
          const next = [...have, ...fresh.map((a) => a.id)];
          LS.set('seq:achievements', JSON.stringify(next));
          set({ achievements: next });
          fresh.forEach((a) => get().toast(`🏆 Unlocked: ${a.emoji} ${a.label}`, 'gold'));
        }
      }
      // if this was today's daily challenge, record the result for Home to show
      if (s.mode === 'local' && s.localSeed && s.localSeed === dailySeed() && myTeam) {
        const moves = game.log.filter(
          (e) => e.kind === 'place' && e.playerId === game.yourId,
        ).length;
        const res: DailyResult = { seed: s.localSeed, won: game.winner === myTeam, moves };
        LS.set(DAILY_KEY, JSON.stringify(res));
        set({ dailyResult: res });
      }
      // best-of match bookkeeping: tally the winning team's game win
      if (s.mode === 'local' && s.seriesTarget > 1 && game.winner) {
        const w = game.winner;
        set({ seriesWins: { ...s.seriesWins, [w]: (s.seriesWins[w] ?? 0) + 1 } });
      }
    } else if (isMyTurn && !s.wasMyTurn) {
      sfx.yourTurn();
      notifyMyTurn(get().prefs.notifyTurn);
    }

    // let the table know when it becomes a backgrounded player's turn (once, on
    // the transition — not on every state re-broadcast)
    if (!over && s.mode === 'online') {
      const cur = game.players[game.turn];
      const prevCur = prev?.players[prev.turn];
      if (
        cur?.away &&
        cur.id !== game.yourId &&
        (prev?.turn !== game.turn || !prevCur?.away)
      ) {
        get().toast(`${cur.name} is away — waiting for them…`, 'info');
      }
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
        // client, clearing any personal override so it truly applies to all.
        // Driven by an epoch that bumps on every host board change (even to the
        // same theme), so re-picking the current theme still re-syncs the table.
        const ep = room.settings?.boardEpoch ?? 0;
        if (ep !== lastBoardEpoch) {
          lastBoardEpoch = ep;
          boardOverridden = false;
        }
        set({ boardView: applyBoardTheme(room.settings?.boardTheme, get().prefs.boardTheme) });
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
      onBecomeHost: async (code, snap) => {
        // the host left and we're the heir, take over hosting on the same code.
        // net.ts is already loaded here (we're inside a live guest), so this is
        // an instant cache hit
        const { name, playerId, prefs } = get();
        const { NetHost } = await loadNet();
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
    lastBoardEpoch = 0;
    set({ boardView: applyBoardTheme(undefined, s.prefs.boardTheme) });
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
      localSeed: null,
      localBotPersona: {},
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
    try {
      set({ boardView: document.body.dataset.board || 'classic' });
    } catch {
      /* no-dom */
    }
  },

  async createRoom() {
    const { name, playerId, prefs } = get();
    get()._goHome();
    get().toast('Setting up your room…');
    const { NetHost } = await loadNet();
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

  async joinRoom(code, password) {
    const { name, playerId, prefs } = get();
    get()._goHome();
    get().toast('Connecting to room…');
    const { NetGuest } = await loadNet();
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
  },

  async spectate(code, password) {
    const { name, playerId, prefs } = get();
    get()._goHome();
    get().toast('Connecting to watch…');
    const { NetGuest } = await loadNet();
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
      // keep this game's house rules and restart the match (fresh series score)
      const core = s.localCore;
      const rules = core
        ? (({ teamCount: _t, botDifficulty: _b, ...r }) => r)(core.settings)
        : undefined;
      get().startLocal(rotated, { settings: rules, series: s.seriesTarget });
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

  setAway(away) {
    const s = get();
    if (s.mode !== 'online' || !s.net) return;
    if (s.netKind === 'host') (s.net as NetHost).setOwnAway(away);
    else if (s.netKind === 'guest') (s.net as NetGuest).setAway(away);
  },

  installReady: false,
  promptInstall() {
    const ev = deferredInstall;
    deferredInstall = null;
    set({ installReady: false });
    // fire-and-forget: the browser shows its own install UI from here
    ev?.prompt().catch(() => {});
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
      localSeed: saved.seed ?? null,
      localBotPersona: saved.persona ?? {},
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

  startLocal(seats, opts) {
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
    // every local deal gets a shareable seed: use the given one (a pasted code or
    // the daily), otherwise mint a fresh one. The seed drives the rng so the same
    // code always deals the same cards and board.
    const seed = opts?.seed ? cleanSeed(opts.seed) : makeSeed();
    const core = createGame(
      seats.map((seat, i) => ({
        id: `L${i}`,
        name: seat.name.trim() || (seat.isBot ? `Bot ${i + 1}` : `Player ${i + 1}`),
        isBot: seat.isBot,
        team: TEAMS[i % teamCount],
      })),
      // a house-rules preset can override any setting; team count and the bot
      // strength you picked in Settings still win
      defaultSettings({ ...opts?.settings, teamCount, botDifficulty: get().prefs.difficulty }),
      seededRng(seed),
    );
    // give each bot a personality, drawn deterministically from the seed so the
    // same deal always faces the same opponents
    const personaList: BotPersonality[] = ['aggressive', 'defensive', 'trickster', 'balanced'];
    const pr = seededRng(seed + ':persona');
    const localBotPersona: Record<string, BotPersonality> = {};
    seats.forEach((seat, i) => {
      if (seat.isBot) localBotPersona[`L${i}`] = personaList[Math.floor(pr() * personaList.length)];
    });
    const firstHuman = core.players.find((p) => !p.isBot);
    const starter = core.players[core.turn];
    set({
      mode: 'local',
      localCore: core,
      localSeats: seats,
      localSeed: seed,
      localBotPersona,
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
      // a fresh match resets the running score; continuing one keeps it
      ...(opts?.keepSeries
        ? {}
        : { seriesTarget: opts?.series ?? 1, seriesWins: { red: 0, blue: 0, green: 0 } }),
    });
    get().localTick();
  },

  nextSeriesGame() {
    const s = get();
    if (!s.localCore) return;
    // reuse this match's seats and house rules, deal a brand-new random board,
    // and keep the running series score
    const { teamCount: _t, botDifficulty: _b, ...rules } = s.localCore.settings;
    get().startLocal(s.localSeats, { settings: rules, keepSeries: true });
  },

  setLocalBotDifficulty(d) {
    const core = get().localCore;
    if (!core) return;
    // bots read settings.botDifficulty when they move, so this takes effect from
    // their next turn onward
    core.settings.botDifficulty = d;
    set({ localCore: core });
    get().toast(`Bots set to ${d}.`, 'info');
  },

  startDaily() {
    const { name } = get();
    // today's fixed deal: you against one hard bot, same cards for everyone
    const seats: LocalSeat[] = [
      { name: name || 'Player', isBot: false },
      { name: '', isBot: true },
    ];
    get().startLocal(seats, { seed: dailySeed(), daily: true });
  },

  startSeed(code) {
    const clean = cleanSeed(code);
    if (!clean) {
      get().toast('Enter a seed code first.', 'error');
      return;
    }
    const { name } = get();
    const seats: LocalSeat[] = [
      { name: name || 'Player', isBot: false },
      { name: '', isBot: true },
    ];
    get().startLocal(seats, { seed: clean });
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
    saveLocalGame(core, s.localSeats, s.localViewer, s.localSeed, s.localBotPersona);

    if (!over && cur?.isBot && !get().localBotTimer) {
      const timer = window.setTimeout(() => {
        set({ localBotTimer: null });
        const c = get().localCore;
        if (!c || c.winner || c.stalemate) return;
        const p = c.players[c.turn];
        if (!p?.isBot) return;
        const mv = chooseBotMove(c, p, c.settings.botDifficulty, get().localBotPersona[p.id]);
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

// tell the table when this player backgrounds/returns, so an online game waits
// for a busy player instead of letting the AI cover their turn
try {
  document.addEventListener('visibilitychange', () => {
    useStore.getState().setAway(document.visibilityState === 'hidden');
  });
} catch {
  /* no document (SSR/tests) */
}

/** Capture the browser's install-app offer (Android/desktop Chrome) so Home can
 * show its own "Install the app" button; installing gives true full screen. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
let deferredInstall: BeforeInstallPromptEvent | null = null;
try {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as BeforeInstallPromptEvent;
    useStore.setState({ installReady: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    useStore.setState({ installReady: false });
  });
} catch {
  /* no window */
}

/** Already running as the installed app (standalone)? Then install/full-screen
 * prompts are pointless and stay hidden. */
export function runningStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** iPhone/iPad, where browsers have no Fullscreen API — the installed app
 * (Share -> Add to Home Screen) is the only full-screen path. */
export function isIOS(): boolean {
  try {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      // iPadOS 13+ reports as Mac but has touch
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
}

/** An iPhone/iPod specifically: iPad puts Share in the top toolbar, not the
 * bottom bar, so instructions differ. */
export function isIPhone(): boolean {
  try {
    return /iPhone|iPod/.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** Safari on iOS, as opposed to Chrome/Firefox/Edge or an in-app web view —
 * those put Share elsewhere, or have no Add to Home Screen at all. */
export function isIOSSafari(): boolean {
  try {
    if (!isIOS()) return false;
    return !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
  } catch {
    return false;
  }
}
