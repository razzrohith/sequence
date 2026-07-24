// Shared types between client and server

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Team = 'red' | 'blue' | 'green';
/** Card code e.g. "TS" = ten of spades, "JH" = jack of hearts */
export type Card = string;

export const TEAMS: Team[] = ['red', 'blue', 'green'];

export interface CellState {
  /** chip color occupying the cell, null if empty (corners are always null) */
  chip: Team | null;
  /** teams whose completed sequence includes this cell (chips here are protected) */
  locked: Team[];
}

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface ServerPlayer {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  hand: Card[];
  connected: boolean;
  avatar?: string;
}

export interface PublicPlayer {
  id: string;
  name: string;
  team: Team;
  isBot: boolean;
  connected: boolean;
  handCount: number;
  avatar?: string;
}

export interface GameSettings {
  /** number of teams (2 or 3) */
  teamCount: 2 | 3;
  /** if true, players must manually draw before the next player finishes or forfeit the card */
  strictDraw: boolean;
  /** AI strength for bots in this room */
  botDifficulty: BotDifficulty;
  /** seconds allowed per turn before auto-play; 0 = no timer */
  turnSeconds: number;
  /** sequences needed to win; omit for the official default (2 teams -> 2, 3 teams -> 1) */
  winSequences?: number;
  /** how taking back a move works: not at all, straight away, or only when an
   * opponent agrees. A move can only ever be taken back while it is still the
   * most recent one, so nobody can undo after the next player has moved. */
  undoMode?: 'off' | 'instant' | 'approval';
  /** deal the 48 faces to random cells instead of the printed board */
  randomBoard?: boolean;
  /** board theme the host has chosen for the whole room; players may still
   * override it locally in Settings */
  boardTheme?: string;
}

export interface SequenceRecord {
  team: Team;
  cells: Array<[number, number]>;
}

export type MoveKind =
  | 'place'
  | 'remove'
  | 'exchangeDead'
  | 'pass'
  | 'draw'
  | 'forfeitDraw';

export interface MoveEvent {
  playerId: string;
  playerName: string;
  team: Team;
  kind: MoveKind;
  card?: Card;
  r?: number;
  c?: number;
  newSequences?: SequenceRecord[];
  n: number; // monotonically increasing event number
}

export interface GameCore {
  board: CellState[][];
  /** which card is printed on each cell (the official board, or a shuffled one) */
  layout: string[][];
  deck: Card[];
  discard: Card[];
  players: ServerPlayer[];
  /** index into players of whose turn it is */
  turn: number;
  settings: GameSettings;
  sequences: SequenceRecord[];
  /** sequences required to win */
  required: number;
  winner: Team | null;
  /** true when no player can ever move again (all hands empty), a draw */
  stalemate: boolean;
  /** turns since a sequence was last completed (dead-position detection) */
  turnsWithoutSequence: number;
  deadExchangedThisTurn: boolean;
  /** playerId -> number of draws owed (strict mode) */
  pendingDraws: Record<string, number>;
  log: MoveEvent[];
  eventCounter: number;
  /** rng used for shuffling (kept so mid-game reshuffles are reproducible) */
  rng?: () => number;
  /** epoch ms the current turn began (for the turn timer) */
  turnStartedAt?: number;
}

export interface ClientGameState {
  board: CellState[][];
  /** the card printed on each cell, so the client renders this game's board */
  layout: string[][];
  players: PublicPlayer[];
  turn: number;
  yourId: string;
  yourHand: Card[];
  deckCount: number;
  discardTop: Card | null;
  sequences: SequenceRecord[];
  required: number;
  winner: Team | null;
  stalemate: boolean;
  settings: GameSettings;
  lastMove: MoveEvent | null;
  deadExchangedThisTurn: boolean;
  yourPendingDraws: number;
  log: MoveEvent[];
  /** epoch ms when the current turn auto-plays (turn timer); null if no timer */
  turnDeadline: number | null;
  /** true if you are watching, not seated */
  spectator?: boolean;
  /** number of watchers */
  spectatorCount?: number;
  /** a pending undo request awaiting your approval */
  undoRequest?: { byId: string; byName: string } | null;
}

export type Move =
  | { type: 'place'; card: Card; r: number; c: number }
  | { type: 'remove'; card: Card; r: number; c: number }
  | { type: 'exchangeDead'; card: Card }
  | { type: 'draw' }
  | { type: 'pass' };

// ---- Lobby / room types ----

export interface LobbyPlayer {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  team: Team | null;
  avatar?: string;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  settings: GameSettings;
  started: boolean;
  validCounts: number[];
  spectatorCount: number;
}

export interface ChatMessage {
  playerId: string;
  name: string;
  team: Team | null;
  text: string;
  ts: number;
}

export interface EmoteMessage {
  playerId: string;
  name: string;
  team: Team | null;
  emote: string;
  ts: number;
}
