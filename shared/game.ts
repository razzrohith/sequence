import {
  BOARD_LAYOUT,
  CARD_POSITIONS,
  DIRS,
  SIZE,
  cardAt,
  isCorner,
} from './board';
import type {
  Card,
  CellState,
  ClientGameState,
  GameCore,
  GameSettings,
  Move,
  MoveEvent,
  SequenceRecord,
  ServerPlayer,
  Team,
} from './types';
import { TEAMS } from './types';

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const SUITS = ['S', 'H', 'D', 'C'] as const;

export const TWO_EYED_JACKS = ['JD', 'JC']; // wild, place anywhere
export const ONE_EYED_JACKS = ['JS', 'JH']; // remove an opponent chip

export function isJack(card: Card): boolean {
  return card[0] === 'J';
}
export function isTwoEyed(card: Card): boolean {
  return TWO_EYED_JACKS.includes(card);
}
export function isOneEyed(card: Card): boolean {
  return ONE_EYED_JACKS.includes(card);
}

/** Official hand sizes by total player count */
export const HAND_SIZES: Record<number, number> = {
  2: 7,
  3: 6,
  4: 6,
  6: 5,
  8: 4,
  9: 4,
  10: 3,
  12: 3,
};

/** player counts that divide evenly into the chosen team count */
export function validPlayerCounts(): number[] {
  return Object.keys(HAND_SIZES).map(Number);
}

export function teamOptionsFor(playerCount: number): Array<2 | 3> {
  const opts: Array<2 | 3> = [];
  if (playerCount % 2 === 0 && HAND_SIZES[playerCount]) opts.push(2);
  if (playerCount % 3 === 0 && HAND_SIZES[playerCount]) opts.push(3);
  return opts;
}

/** In-place Fisher-Yates shuffle using the given rng. */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createDeck(rng: () => number = Math.random): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < 2; d++) {
    for (const s of SUITS) {
      for (const r of RANKS) {
        deck.push(r + s);
      }
    }
  }
  return shuffle(deck, rng);
}

export function emptyBoard(): CellState[][] {
  const board: CellState[][] = [];
  for (let r = 0; r < SIZE; r++) {
    const row: CellState[] = [];
    for (let c = 0; c < SIZE; c++) {
      row.push({ chip: null, locked: [] });
    }
    board.push(row);
  }
  return board;
}

export interface SetupPlayer {
  id: string;
  name: string;
  isBot: boolean;
}

/**
 * Create a fresh game. Players are seated so team membership alternates
 * (team = seat index % teamCount), per the official rules.
 */
export function createGame(
  seatedPlayers: Array<SetupPlayer & { team: Team }>,
  settings: GameSettings,
  rng: () => number = Math.random,
): GameCore {
  const deck = createDeck(rng);
  const handSize = HAND_SIZES[seatedPlayers.length] ?? 6;
  const players: ServerPlayer[] = seatedPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    isBot: p.isBot,
    hand: deck.splice(0, handSize),
    connected: true,
  }));
  return {
    board: emptyBoard(),
    deck,
    discard: [],
    players,
    turn: 0,
    settings,
    sequences: [],
    // the quick-win override is only offered for 2-team games; clamp it so a
    // stale value can never survive a switch to 3 teams (or set required to 0)
    required:
      settings.teamCount === 2
        ? Math.min(2, Math.max(1, settings.winSequences ?? 2))
        : 1,
    winner: null,
    stalemate: false,
    turnsWithoutSequence: 0,
    deadExchangedThisTurn: false,
    pendingDraws: {},
    log: [],
    eventCounter: 0,
    rng,
    turnStartedAt: Date.now(),
  };
}

/** Default room settings (used when a caller doesn't specify every field). */
export function defaultSettings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    teamCount: partial.teamCount ?? 2,
    strictDraw: partial.strictDraw ?? false,
    botDifficulty: partial.botDifficulty ?? 'medium',
    turnSeconds: partial.turnSeconds ?? 0,
    winSequences: partial.winSequences,
  };
}

/** A card is dead when it's a non-jack whose two board cells are both occupied. */
export function isDeadOnBoard(board: CellState[][], card: Card): boolean {
  if (isJack(card)) return false;
  const positions = CARD_POSITIONS.get(card);
  if (!positions) return true; // shouldn't happen
  return positions.every(([r, c]) => board[r][c].chip !== null);
}

export function isDeadCard(game: GameCore, card: Card): boolean {
  return isDeadOnBoard(game.board, card);
}

/** Cells where `card` can legally be played by `team` (board-only, shared with client UI). */
export function legalCellsOnBoard(
  board: CellState[][],
  team: Team,
  card: Card,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (isTwoEyed(card)) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!isCorner(r, c) && board[r][c].chip === null) out.push([r, c]);
      }
    }
    return out;
  }
  if (isOneEyed(card)) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = board[r][c];
        if (
          cell.chip !== null &&
          cell.chip !== team &&
          !cell.locked.includes(cell.chip) // can't break a completed sequence
        ) {
          out.push([r, c]);
        }
      }
    }
    return out;
  }
  const positions = CARD_POSITIONS.get(card) ?? [];
  for (const [r, c] of positions) {
    if (board[r][c].chip === null) out.push([r, c]);
  }
  return out;
}

export function legalCellsFor(game: GameCore, team: Team, card: Card): Array<[number, number]> {
  return legalCellsOnBoard(game.board, team, card);
}

export function hasAnyLegalMove(game: GameCore, player: ServerPlayer): boolean {
  return player.hand.some((card) => legalCellsFor(game, player.team, card).length > 0);
}

function drawCard(game: GameCore, player: ServerPlayer): Card | null {
  if (game.deck.length === 0 && game.discard.length > 0) {
    // reshuffle the discard pile using the game's own rng (reproducible)
    game.deck = shuffle(game.discard, game.rng ?? Math.random);
    game.discard = [];
  }
  const card = game.deck.pop() ?? null;
  if (card) player.hand.push(card);
  return card;
}

function pushEvent(game: GameCore, e: Omit<MoveEvent, 'n'>): MoveEvent {
  const ev: MoveEvent = { ...e, n: ++game.eventCounter };
  game.log.push(ev);
  if (game.log.length > 60) game.log.splice(0, game.log.length - 60);
  return ev;
}

/**
 * After a chip is placed at (r,c) for `team`, detect any newly completed
 * sequences. A new sequence may share at most ONE cell with a previously
 * completed sequence of the same team (official rule).
 */
function detectNewSequences(game: GameCore, team: Team, r: number, c: number): SequenceRecord[] {
  const found: SequenceRecord[] = [];
  const counts = (rr: number, cc: number) =>
    isCorner(rr, cc) || game.board[rr][cc].chip === team;

  for (const [dr, dc] of DIRS) {
    // collect the maximal run through (r,c) in this direction
    const run: Array<[number, number]> = [];
    let sr = r;
    let sc = c;
    while (true) {
      const nr = sr - dr;
      const nc = sc - dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || !counts(nr, nc)) break;
      sr = nr;
      sc = nc;
    }
    let cr = sr;
    let cc2 = sc;
    while (cr >= 0 && cr < SIZE && cc2 >= 0 && cc2 < SIZE && counts(cr, cc2)) {
      run.push([cr, cc2]);
      cr += dr;
      cc2 += dc;
    }
    if (run.length < 5) continue;

    // slide 5-windows over the run; a window qualifies if at most one of its
    // cells is already part of one of this team's sequences
    for (let start = 0; start + 5 <= run.length; start++) {
      const window = run.slice(start, start + 5);
      const alreadyLocked = window.filter(([wr, wc]) =>
        game.board[wr][wc].locked.includes(team),
      ).length;
      if (alreadyLocked <= 1) {
        for (const [wr, wc] of window) {
          const cell = game.board[wr][wc];
          if (!cell.locked.includes(team)) cell.locked.push(team);
        }
        const rec: SequenceRecord = { team, cells: window };
        game.sequences.push(rec);
        found.push(rec);
      }
    }
  }
  return found;
}

function teamSequenceCount(game: GameCore, team: Team): number {
  return game.sequences.filter((s) => s.team === team).length;
}

/** After this many consecutive turns with no new sequence, the position is
 * declared dead and the game drawn. A real game averages 20 to 80 turns; this
 * only triggers on genuinely locked boards (mostly 3-team endgames). */
const DEAD_POSITION_TURNS = 400;

function advanceTurn(game: GameCore) {
  game.turn = (game.turn + 1) % game.players.length;
  game.deadExchangedThisTurn = false;
  game.turnStartedAt = Date.now();
  game.turnsWithoutSequence++;
  // stalemate: with every hand empty nobody can ever play or draw again.
  // In strict mode a player keeps a claimable pending draw until the NEXT player
  // moves, so an owed draw with cards still available means the game isn't dead.
  const cardsLeft = game.deck.length + game.discard.length > 0;
  const anyClaimableDraw = game.players.some((p) => (game.pendingDraws[p.id] ?? 0) > 0);
  if (game.players.every((p) => p.hand.length === 0) && !(cardsLeft && anyClaimableDraw)) {
    game.stalemate = true;
  }
  if (game.turnsWithoutSequence >= DEAD_POSITION_TURNS) {
    game.stalemate = true;
  }
}

/** In strict mode: when a player finishes a turn, everyone ELSE with an
 * unclaimed pending draw forfeits it permanently. */
function forfeitStalePendingDraws(game: GameCore, moverId: string) {
  if (!game.settings.strictDraw) return;
  for (const p of game.players) {
    if (p.id !== moverId && (game.pendingDraws[p.id] ?? 0) > 0) {
      game.pendingDraws[p.id] = 0;
      pushEvent(game, {
        playerId: p.id,
        playerName: p.name,
        team: p.team,
        kind: 'forfeitDraw',
      });
    }
  }
}

function finishCardPlay(game: GameCore, player: ServerPlayer, card: Card) {
  // remove from hand, discard, guard the index so a caller bug can't silently
  // splice the wrong card (callers must have already verified the card is held)
  const idx = player.hand.indexOf(card);
  if (idx === -1) return;
  player.hand.splice(idx, 1);
  game.discard.push(card);
  if (game.settings.strictDraw) {
    game.pendingDraws[player.id] = (game.pendingDraws[player.id] ?? 0) + 1;
  } else {
    drawCard(game, player);
  }
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  events?: MoveEvent[];
}

export function applyMove(game: GameCore, playerId: string, move: Move): ApplyResult {
  if (game.winner || game.stalemate) return { ok: false, error: 'The game is over.' };
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Unknown player.' };

  // drawing a pending card (strict mode) is allowed any time before forfeiture
  if (move.type === 'draw') {
    if (!game.settings.strictDraw) return { ok: false, error: 'Cards are drawn automatically.' };
    const owed = game.pendingDraws[playerId] ?? 0;
    if (owed <= 0) return { ok: false, error: 'No card to draw.' };
    game.pendingDraws[playerId] = owed - 1;
    drawCard(game, player);
    const ev = pushEvent(game, {
      playerId,
      playerName: player.name,
      team: player.team,
      kind: 'draw',
    });
    return { ok: true, events: [ev] };
  }

  if (game.players[game.turn].id !== playerId) {
    return { ok: false, error: 'Not your turn.' };
  }

  const events: MoveEvent[] = [];

  switch (move.type) {
    case 'exchangeDead': {
      if (game.deadExchangedThisTurn)
        return { ok: false, error: 'You can only exchange one dead card per turn.' };
      if (!player.hand.includes(move.card)) return { ok: false, error: 'Card not in hand.' };
      if (!isDeadCard(game, move.card)) return { ok: false, error: 'That card is not dead.' };
      const idx = player.hand.indexOf(move.card);
      player.hand.splice(idx, 1);
      game.discard.push(move.card);
      drawCard(game, player);
      game.deadExchangedThisTurn = true;
      events.push(
        pushEvent(game, {
          playerId,
          playerName: player.name,
          team: player.team,
          kind: 'exchangeDead',
          card: move.card,
        }),
      );
      return { ok: true, events };
    }

    case 'place': {
      if (!player.hand.includes(move.card)) return { ok: false, error: 'Card not in hand.' };
      const { r, c } = move;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || isCorner(r, c))
        return { ok: false, error: 'Invalid cell.' };
      if (game.board[r][c].chip !== null) return { ok: false, error: 'That space is taken.' };
      if (isOneEyed(move.card))
        return { ok: false, error: 'One-eyed jacks remove chips; they cannot place.' };
      if (!isTwoEyed(move.card)) {
        const matches = (CARD_POSITIONS.get(move.card) ?? []).some(
          ([pr, pc]) => pr === r && pc === c,
        );
        if (!matches) return { ok: false, error: 'That card does not match this space.' };
      }
      forfeitStalePendingDraws(game, playerId);
      game.board[r][c].chip = player.team;
      finishCardPlay(game, player, move.card);
      const newSeqs = detectNewSequences(game, player.team, r, c);
      events.push(
        pushEvent(game, {
          playerId,
          playerName: player.name,
          team: player.team,
          kind: 'place',
          card: move.card,
          r,
          c,
          newSequences: newSeqs,
        }),
      );
      if (newSeqs.length > 0) game.turnsWithoutSequence = 0;
      if (teamSequenceCount(game, player.team) >= game.required) {
        game.winner = player.team;
      } else {
        advanceTurn(game);
      }
      return { ok: true, events };
    }

    case 'remove': {
      if (!player.hand.includes(move.card)) return { ok: false, error: 'Card not in hand.' };
      if (!isOneEyed(move.card))
        return { ok: false, error: 'Only a one-eyed jack can remove a chip.' };
      const { r, c } = move;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || isCorner(r, c))
        return { ok: false, error: 'Invalid cell.' };
      const cell = game.board[r][c];
      if (cell.chip === null) return { ok: false, error: 'No chip there.' };
      if (cell.chip === player.team) return { ok: false, error: "You can't remove your own chip." };
      if (cell.locked.includes(cell.chip))
        return { ok: false, error: 'Chips in a completed sequence are protected.' };
      forfeitStalePendingDraws(game, playerId);
      cell.chip = null;
      finishCardPlay(game, player, move.card);
      events.push(
        pushEvent(game, {
          playerId,
          playerName: player.name,
          team: player.team,
          kind: 'remove',
          card: move.card,
          r,
          c,
        }),
      );
      advanceTurn(game);
      return { ok: true, events };
    }

    case 'pass': {
      // a player may only pass with no legal move; exchanging a dead card is
      // optional (per official rules) so it never blocks a pass
      if (hasAnyLegalMove(game, player))
        return { ok: false, error: 'You have a legal move, you cannot pass.' };
      forfeitStalePendingDraws(game, playerId);
      events.push(
        pushEvent(game, {
          playerId,
          playerName: player.name,
          team: player.team,
          kind: 'pass',
        }),
      );
      advanceTurn(game);
      return { ok: true, events };
    }
  }
  return { ok: false, error: 'Unknown move.' };
}

/** A guaranteed-legal move for a player, used as a failsafe so an AI seat can
 * never leave a turn stuck (find any legal play; pass is legal iff none exist). */
export function forceLegalMove(game: GameCore, player: ServerPlayer): Move {
  for (const card of player.hand) {
    const cells = legalCellsFor(game, player.team, card);
    if (cells.length) {
      const [r, c] = cells[0];
      return isOneEyed(card) ? { type: 'remove', card, r, c } : { type: 'place', card, r, c };
    }
  }
  if (!game.deadExchangedThisTurn) {
    const dead = player.hand.find((c) => isDeadCard(game, c));
    if (dead) return { type: 'exchangeDead', card: dead };
  }
  return { type: 'pass' };
}

export function toClientState(game: GameCore, playerId: string): ClientGameState {
  const you = game.players.find((p) => p.id === playerId);
  const secs = game.settings.turnSeconds ?? 0;
  const over = !!game.winner || game.stalemate;
  const turnDeadline =
    secs > 0 && !over && game.turnStartedAt ? game.turnStartedAt + secs * 1000 : null;
  return {
    board: game.board,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      isBot: p.isBot,
      connected: p.connected,
      handCount: p.hand.length,
      avatar: p.avatar,
    })),
    turn: game.turn,
    yourId: playerId,
    yourHand: you ? [...you.hand] : [],
    deckCount: game.deck.length,
    discardTop: game.discard.length ? game.discard[game.discard.length - 1] : null,
    sequences: game.sequences,
    required: game.required,
    winner: game.winner,
    stalemate: game.stalemate,
    settings: game.settings,
    lastMove: game.log.length ? game.log[game.log.length - 1] : null,
    deadExchangedThisTurn: game.deadExchangedThisTurn,
    yourPendingDraws: game.pendingDraws[playerId] ?? 0,
    log: game.log.slice(-20),
    turnDeadline,
  };
}

/** Validate the board layout: 48 distinct cards, each appearing exactly twice. */
export function validateBoardLayout(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  let corners = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = BOARD_LAYOUT[r][c];
      if (v === 'XX') {
        corners++;
        if (!isCorner(r, c)) problems.push(`wild at non-corner ${r},${c}`);
        continue;
      }
      counts.set(v, (counts.get(v) ?? 0) + 1);
      if (v[0] === 'J') problems.push(`jack on board at ${r},${c}`);
    }
  }
  if (corners !== 4) problems.push(`expected 4 corners, got ${corners}`);
  if (counts.size !== 48) problems.push(`expected 48 distinct cards, got ${counts.size}`);
  for (const [card, n] of counts) {
    if (n !== 2) problems.push(`card ${card} appears ${n} times`);
  }
  for (const rank of RANKS) {
    if (rank === 'J') continue;
    for (const suit of SUITS) {
      if (!counts.has(rank + suit)) problems.push(`missing card ${rank + suit}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export { cardAt, isCorner, SIZE };
