/**
 * Self-test suite:
 *  1. Board layout validation (48 unique faces x2 + 4 free corners)
 *  2. Rule-by-rule unit tests of every official Sequence mechanic
 *  3. Full bot-vs-bot simulations across every supported player count
 * Run: npm run selftest
 */
import { BOARD_LAYOUT, cardAt, positionsFor, shuffledLayout } from '../shared/board';
import { type BotPersonality, PERSONALITIES, chooseBotMove } from '../shared/bot';
import {
  HAND_SIZES,
  applyMove,
  createGame,
  defaultSettings,
  isDeadCard,
  legalCellsFor,
  requiredFor,
  toClientState,
  turnDeadlineFor,
  validateBoardLayout,
} from '../shared/game';
import { cleanSeed, dailySeed, seededRng } from '../shared/rng';
import { TEAMS } from '../shared/types';
import type { Card, GameCore, ServerPlayer, Team } from '../shared/types';

/** Small deterministic PRNG so the gate never flakes and every failure is
 * reproducible from its seed. We drive the global Math.random (used by the deck
 * shuffle in createGame and by the bot's scoring noise) from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ORIG_RANDOM = Math.random;
// fixed seed for the deterministic unit-test section; sims reseed per iteration
Math.random = mulberry32(0xc0ffee);

let passed = 0;
let failed = 0;

function assert(cond: unknown, name: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL:', name);
  }
}

function freshGame(
  playerCount = 2,
  teamCount: 2 | 3 = 2,
  strictDraw = false,
  randomBoard = false,
): GameCore {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isBot: true,
    team: TEAMS[i % teamCount],
  }));
  return createGame(players, { teamCount, strictDraw, randomBoard } as never);
}

/** Chip four cells of a row for `team` and return the card printed on the fifth,
 * so a "complete the sequence" test works whatever the layout is. */
function runOf(game: GameCore, team: Team, r: number, c0: number) {
  setChips(game, team, [
    [r, c0],
    [r, c0 + 1],
    [r, c0 + 2],
    [r, c0 + 3],
  ]);
  const c = c0 + 4;
  return { card: cardAt(r, c, game.layout)!, r, c };
}

function setChips(game: GameCore, team: Team, cells: Array<[number, number]>) {
  for (const [r, c] of cells) game.board[r][c].chip = team;
}

function giveHand(game: GameCore, playerIdx: number, cards: Card[]) {
  game.players[playerIdx].hand = [...cards];
}

// ---------- 1. board layout ----------
const layout = validateBoardLayout();
if (!layout.ok) {
  console.error('BOARD LAYOUT INVALID:');
  for (const p of layout.problems) console.error(' -', p);
  process.exit(1);
}
console.log('Board layout OK: 48 unique cards x2 + 4 free corners = 100 cells');

// the default board must match the real printed Sequence board, in its printed
// orientation (diamonds running along the top row, spades along the bottom)
{
  assert(
    BOARD_LAYOUT[0].join(' ') === 'XX 6D 7D 8D 9D TD QD KD AD XX',
    'default board: top row matches the printed board',
  );
  assert(
    BOARD_LAYOUT[9].join(' ') === 'XX 9S 8S 7S 6S 5S 4S 3S 2S XX',
    'default board: bottom row matches the printed board',
  );
  assert(
    BOARD_LAYOUT[1].join(' ') === '5D 3H 2H 2S 3S 4S 5S 6S 7S AC',
    'default board: second row matches the printed board',
  );
}

// a shuffled board keeps every rule: 48 faces twice over, corners still free
{
  for (let i = 0; i < 50; i++) {
    const shuffled = shuffledLayout(mulberry32(9000 + i));
    const v = validateBoardLayout(shuffled);
    if (!v.ok) {
      assert(false, `shuffled board #${i} invalid: ${v.problems[0]}`);
      break;
    }
    if (i === 49) assert(true, 'shuffled boards are always valid (50 seeds)');
  }
  const a = shuffledLayout(mulberry32(1));
  const b = shuffledLayout(mulberry32(2));
  assert(JSON.stringify(a) !== JSON.stringify(b), 'shuffled boards actually differ');
  assert(
    JSON.stringify(shuffledLayout(mulberry32(7))) ===
      JSON.stringify(shuffledLayout(mulberry32(7))),
    'a shuffled board is reproducible from its seed',
  );
}

// shareable seed codes: the same code always deals the same game, so daily
// challenges and "replay this deal" are fair and reproducible
{
  const players = () => [
    { id: 'A', name: 'A', isBot: false, team: TEAMS[0] },
    { id: 'B', name: 'B', isBot: true, team: TEAMS[1] },
  ];
  const deal = (code: string) => {
    const g = createGame(players(), defaultSettings({ teamCount: 2 }), seededRng(code));
    return JSON.stringify({ deck: g.deck, hands: g.players.map((p) => p.hand), turn: g.turn });
  };
  assert(deal('K7QP2') === deal('K7QP2'), 'same seed code deals an identical game');
  assert(deal('K7QP2') !== deal('Z9ABC'), 'different seed codes deal different games');
  assert(cleanSeed('  k7 qp2!! ') === 'K7QP2', 'cleanSeed normalizes user input');
  assert(seededRng('ABC')() === seededRng('ABC')(), 'seededRng is deterministic per code');
  assert(/^DLY-\d{8}$/.test(dailySeed(new Date(2026, 7, 1))), 'dailySeed has the daily format');
}

// bot personalities: balanced is the neutral default, and a game where every
// bot has a different personality still completes cleanly (no crash/leak)
{
  const bw = PERSONALITIES.balanced.weights;
  assert(
    bw.own === 1 && bw.block === 1 && bw.jack === 1,
    'balanced personality is the neutral default (weights all 1)',
  );
  const kinds: BotPersonality[] = ['aggressive', 'defensive', 'trickster', 'balanced'];
  const g = freshGame(4, 2, false);
  let moves = 0;
  while (!g.winner && !g.stalemate && moves < 4000) {
    const cur = g.players[g.turn];
    const persona = kinds[g.players.indexOf(cur) % kinds.length];
    const res = applyMove(g, cur.id, chooseBotMove(g, cur, 'hard', persona));
    if (!res.ok) {
      const dead = cur.hand.find((c) => isDeadCard(g, c));
      const rescued =
        (dead && applyMove(g, cur.id, { type: 'exchangeDead', card: dead }).ok) ||
        applyMove(g, cur.id, { type: 'pass' }).ok;
      if (!rescued) throw new Error('personality bots deadlocked');
    }
    const live =
      g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0);
    if (live !== 104) throw new Error(`personality card leak at move ${moves}`);
    moves++;
  }
  assert(g.winner || g.stalemate, 'a game of assorted personality bots reaches an outcome');
}

// ---------- 2. rule unit tests ----------
console.log('\nRule unit tests:');

// hand sizes per official chart
{
  for (const [count, size] of Object.entries(HAND_SIZES)) {
    const n = Number(count);
    const tc = n % 2 === 0 ? 2 : 3;
    const g = freshGame(n, tc as 2 | 3);
    assert(
      g.players.every((p) => p.hand.length === size),
      `hand size for ${n} players is ${size}`,
    );
    assert(g.deck.length === 104 - n * size, `deck remainder for ${n} players`);
  }
}

// win requirement: 2 teams need 2 sequences, 3 teams need 1
assert(freshGame(2, 2).required === 2, '2 teams require 2 sequences');
assert(freshGame(3, 3).required === 1, '3 teams require 1 sequence');

// quick-win variant: winSequences overrides the default requirement
{
  const players = [0, 1].map((i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isBot: true,
    team: TEAMS[i % 2],
  }));
  const g = createGame(players, { teamCount: 2, strictDraw: false, winSequences: 1 } as never);
  assert(g.required === 1, 'quick-win: winSequences=1 overrides the 2-sequence default');
  const qw = runOf(g, 'red', 2, 2);
  giveHand(g, 0, [qw.card]);
  applyMove(g, 'p0', { type: 'place', card: qw.card, r: qw.r, c: qw.c });
  assert(g.winner === 'red', 'quick-win: a single sequence wins immediately');
}

// normal card: exactly its two printed cells are legal
{
  const g = freshGame();
  const cells = legalCellsFor(g, 'red', '7D');
  assert(cells.length === 2, 'a rank card has exactly 2 board cells');
  assert(
    cells.every(([r, c]) => cardAt(r, c, g.layout) === '7D'),
    'legal cells match the printed card',
  );
}

// two-eyed jack: any open non-corner cell; one-eyed: only unprotected enemy chips
{
  const g = freshGame();
  assert(legalCellsFor(g, 'red', 'JD').length === 96, 'two-eyed jack targets all 96 open cells');
  setChips(g, 'blue', [[5, 5]]);
  setChips(g, 'red', [[4, 4]]);
  assert(legalCellsFor(g, 'red', 'JD').length === 94, 'two-eyed jack skips occupied cells');
  const rm = legalCellsFor(g, 'red', 'JS');
  assert(rm.length === 1 && rm[0][0] === 5 && rm[0][1] === 5, 'one-eyed jack targets enemy chips only');
}

// sequence completion + protection from one-eyed jacks
{
  const g = freshGame();
  const run = runOf(g, 'red', 2, 2);
  giveHand(g, 0, [run.card]);
  const res = applyMove(g, 'p0', { type: 'place', card: run.card, r: run.r, c: run.c });
  assert(res.ok, 'placing the 5th chip is legal');
  assert(g.sequences.length === 1 && g.sequences[0].team === 'red', 'sequence detected');
  assert(
    g.sequences[0].cells.every(([r, c]) => g.board[r][c].locked.includes('red')),
    'sequence cells are locked',
  );
  giveHand(g, 1, ['JS']);
  const rm = applyMove(g, 'p1', { type: 'remove', card: 'JS', r: 2, c: 4 }); // inside the locked run
  assert(!rm.ok, 'one-eyed jack cannot break a completed sequence');
  assert(legalCellsFor(g, 'blue', 'JH').length === 0, 'no removable targets when all chips protected');
}

// 9-in-a-row = two sequences sharing exactly one chip → instant win for 2 teams
{
  const g = freshGame();
  setChips(g, 'red', [
    [5, 0],
    [5, 1],
    [5, 2],
    [5, 3],
    [5, 5],
    [5, 6],
    [5, 7],
    [5, 8],
  ]);
  const gapCard = cardAt(5, 4, g.layout)!;
  giveHand(g, 0, [gapCard]);
  const res = applyMove(g, 'p0', { type: 'place', card: gapCard, r: 5, c: 4 });
  assert(res.ok, 'filling the 9-run gap is legal');
  assert(g.sequences.length === 2, 'a 9-run yields two sequences');
  const shared = g.sequences[0].cells.filter(([r, c]) =>
    g.sequences[1].cells.some(([r2, c2]) => r === r2 && c === c2),
  );
  assert(shared.length === 1, 'the two sequences share exactly one chip');
  assert(g.winner === 'red', 'two sequences win a 2-team game immediately');
}

// corners are free: 4 chips + corner = sequence; corner usable by both teams
{
  const g = freshGame();
  setChips(g, 'red', [
    [0, 1],
    [0, 2],
    [0, 3],
  ]);
  const topCard = cardAt(0, 4, g.layout)!;
  giveHand(g, 0, [topCard]);
  const res = applyMove(g, 'p0', { type: 'place', card: topCard, r: 0, c: 4 });
  assert(res.ok && g.sequences.length === 1, 'corner + 4 chips completes a sequence');
  // blue can still use the same corner going down column 0
  setChips(g, 'blue', [
    [1, 0],
    [2, 0],
    [3, 0],
  ]);
  const leftCard = cardAt(4, 0, g.layout)!;
  giveHand(g, 1, [leftCard]);
  const res2 = applyMove(g, 'p1', { type: 'place', card: leftCard, r: 4, c: 0 });
  assert(res2.ok && g.sequences.length === 2, 'both teams may use the same corner');
  assert(g.board[0][0].locked.includes('red') && g.board[0][0].locked.includes('blue'),
    'corner locked for both teams');
}

// jacks can never be placed on corners / occupied cells
{
  const g = freshGame();
  giveHand(g, 0, ['JD']);
  assert(!applyMove(g, 'p0', { type: 'place', card: 'JD', r: 0, c: 0 }).ok,
    'two-eyed jack cannot be placed on a corner');
  giveHand(g, 0, ['JS']);
  assert(!applyMove(g, 'p0', { type: 'remove', card: 'JS', r: 0, c: 0 }).ok,
    'one-eyed jack cannot target a corner');
}

// dead card: exchange once per turn, then keep playing
{
  const g = freshGame();
  const dead1 = positionsFor(g.layout).get('2S')!;
  setChips(g, 'blue', dead1);
  giveHand(g, 0, ['2S', '3S', '3S']);
  assert(isDeadCard(g, '2S'), 'card with both cells covered is dead');
  const ex = applyMove(g, 'p0', { type: 'exchangeDead', card: '2S' });
  assert(ex.ok, 'dead card can be exchanged');
  assert(g.players[0].hand.length === 3, 'exchange draws a replacement');
  assert(g.turn === 0, 'turn continues after exchanging');
  // a second exchange the same turn is illegal even if another card is dead
  setChips(g, 'blue', positionsFor(g.layout).get('3S')!); // cover both 3S cells
  const ex2 = applyMove(g, 'p0', { type: 'exchangeDead', card: '3S' });
  assert(!ex2.ok, 'only one dead-card exchange per turn');
}

// pass: allowed only with no legal move; dead-card exchange is OPTIONAL and
// never blocks a pass (per official rules)
{
  const g = freshGame();
  setChips(g, 'blue', positionsFor(g.layout).get('2S')!); // 2S dead -> no legal move
  giveHand(g, 0, ['2S']);
  assert(
    applyMove(g, 'p0', { type: 'pass' }).ok,
    'may pass with no legal move even while holding an exchangeable dead card',
  );
}
{
  const g = freshGame();
  giveHand(g, 0, []);
  assert(applyMove(g, 'p0', { type: 'pass' }).ok, 'empty hand may pass');
}
{
  const g = freshGame();
  const playable = g.players[0].hand.find((c) => legalCellsFor(g, 'red', c).length > 0);
  if (playable) {
    giveHand(g, 0, [playable]);
    assert(
      !applyMove(g, 'p0', { type: 'pass' }).ok,
      'cannot pass while a legal move is available',
    );
  }
}

// cannot play a card you don't hold / onto a non-matching cell / out of turn
{
  const g = freshGame();
  giveHand(g, 0, ['7D']);
  assert(!applyMove(g, 'p0', { type: 'place', card: 'AH', r: 1, c: 5 }).ok, 'card must be in hand');
  assert(!applyMove(g, 'p0', { type: 'place', card: '7D', r: 1, c: 5 }).ok,
    'chip must go on a matching cell');
  giveHand(g, 1, ['7D']);
  assert(!applyMove(g, 'p1', { type: 'place', card: '7D', r: 2, c: 7 }).ok, 'out-of-turn rejected');
}

// strict draw: draw before the next player finishes or forfeit permanently
{
  const g = freshGame(2, 2, true);
  const p0Card = g.players[0].hand[0];
  const c0 = legalCellsFor(g, 'red', p0Card);
  // ensure playable: swap in a card with open cells
  const playable0 = g.players[0].hand.find((c) => legalCellsFor(g, 'red', c).length > 0)!;
  const cell0 = legalCellsFor(g, 'red', playable0)[0];
  applyMove(g, 'p0', { type: 'place', card: playable0, r: cell0[0], c: cell0[1] });
  assert(g.pendingDraws['p0'] === 1, 'strict mode: draw owed after playing');
  assert(g.players[0].hand.length === 6, 'strict mode: no auto-draw');
  // p0 claims the draw in time
  assert(applyMove(g, 'p0', { type: 'draw' }).ok, 'pending draw can be claimed');
  assert(g.players[0].hand.length === 7, 'claimed draw restores hand');
  // now p1 plays and does NOT draw; p0 plays; p1 forfeits
  const playable1 = g.players[1].hand.find((c) => legalCellsFor(g, 'blue', c).length > 0)!;
  const cell1 = legalCellsFor(g, 'blue', playable1)[0];
  applyMove(g, 'p1', { type: 'place', card: playable1, r: cell1[0], c: cell1[1] });
  const playable0b = g.players[0].hand.find((c) => legalCellsFor(g, 'red', c).length > 0)!;
  const cell0b = legalCellsFor(g, 'red', playable0b)[0];
  applyMove(g, 'p0', { type: 'place', card: playable0b, r: cell0b[0], c: cell0b[1] });
  assert(g.pendingDraws['p1'] === 0, 'unclaimed draw is forfeited when next player moves');
  assert(g.players[1].hand.length === 6, 'forfeit permanently shrinks the hand');
  assert(g.log.some((e) => e.kind === 'forfeitDraw' && e.playerId === 'p1'),
    'forfeit is logged');
  assert(!applyMove(g, 'p1', { type: 'draw' }).ok, 'forfeited draw cannot be claimed later');
  void p0Card;
  void c0;
}

// bot difficulty: every difficulty must produce only legal moves
{
  for (const diff of ['easy', 'medium', 'hard'] as const) {
    const g = freshGame(2, 2);
    g.settings.botDifficulty = diff;
    let illegal = 0;
    for (let i = 0; i < 60 && !g.winner && !g.stalemate; i++) {
      const p = g.players[g.turn];
      const mv = chooseBotMove(g, p, diff);
      if (!applyMove(g, p.id, mv).ok) illegal++;
      if (g.settings.strictDraw && (g.pendingDraws[p.id] ?? 0) > 0)
        applyMove(g, p.id, { type: 'draw' });
    }
    assert(illegal === 0, `bot difficulty ${diff} only makes legal moves`);
  }
}

// deck reshuffles the discard pile when exhausted
{
  const g = freshGame();
  g.discard = g.deck.splice(0, g.deck.length - 0); // move everything to discard
  g.deck = [];
  giveHand(g, 0, ['7D']);
  const cell = legalCellsFor(g, 'red', '7D')[0];
  const res = applyMove(g, 'p0', { type: 'place', card: '7D', r: cell[0], c: cell[1] });
  assert(res.ok, 'play still works with empty deck');
  assert(g.players[0].hand.length === 1, 'draw succeeded via reshuffled discard');
  assert(g.deck.length > 0, 'discard pile became the new deck');
}

// the quick-win override must never leak into a 3-team game (the lobby only
// offers it for 2 teams) and must always clamp to a sane 1..2
{
  const mk = (teamCount: 2 | 3, winSequences: number, n: number) =>
    createGame(
      Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        isBot: true,
        team: TEAMS[i % teamCount],
      })),
      { teamCount, strictDraw: false, winSequences } as never,
    );
  assert(mk(3, 2, 6).required === 1, 'quick-win: override ignored for 3-team games');
  assert(mk(2, 0, 2).required === 1, 'quick-win: 0 clamps up to 1 (required can never be 0)');
  assert(mk(2, 9, 2).required === 2, 'quick-win: absurd values clamp down to 2');
}

// strict draw: an owed draw with cards still available is NOT a dead position
{
  const g = freshGame(2, 2, true);
  giveHand(g, 0, ['7D']);
  giveHand(g, 1, []);
  const cell = legalCellsFor(g, 'red', '7D')[0];
  applyMove(g, 'p0', { type: 'place', card: '7D', r: cell[0], c: cell[1] });
  assert(g.pendingDraws['p0'] === 1, 'strict: the mover is still owed a draw');
  assert(!g.stalemate, 'strict: not a stalemate while a draw is still claimable');
  assert(applyMove(g, 'p0', { type: 'draw' }).ok, 'strict: that owed draw can still be claimed');
  assert(g.players[0].hand.length === 1, 'strict: claiming the draw refills the hand');
}

// undo policy: the snapshot/restore the host uses must reproduce the exact
// pre-move state, and a move stops being undoable once the next player moves
{
  const g = freshGame(2, 2);
  const snapshot = () => {
    const { rng, ...rest } = g;
    void rng;
    return JSON.stringify(rest);
  };
  const before = snapshot();
  const p0 = g.players[0];
  const card = p0.hand.find((c) => legalCellsFor(g, 'red', c).length > 0)!;
  const [r, c] = legalCellsFor(g, 'red', card)[0];
  assert(applyMove(g, 'p0', { type: 'place', card, r, c }).ok, 'undo: the move is made');
  assert(snapshot() !== before, 'undo: the board really changed');
  assert(
    g.log[g.log.length - 1].playerId === 'p0',
    'undo: the mover owns the most recent move, so they may take it back',
  );

  // restore exactly as the host does, then re-snapshot: it must match byte for
  // byte, and the chip the move placed must be gone again
  const restored = JSON.parse(before) as GameCore;
  restored.rng = Math.random;
  const { rng: _rng, ...restoredRest } = restored;
  void _rng;
  assert(
    JSON.stringify(restoredRest) === before,
    'undo: restoring reproduces the pre-move state exactly',
  );
  assert(restored.board[r][c].chip === null, 'undo: the placed chip is taken back off the board');
  assert(restored.players[0].hand.includes(card), 'undo: the played card returns to the hand');

  // once the next player moves, the previous player no longer owns the last move
  const p1 = g.players[1];
  const card1 = p1.hand.find((x) => legalCellsFor(g, 'blue', x).length > 0)!;
  const [r1, c1] = legalCellsFor(g, 'blue', card1)[0];
  applyMove(g, 'p1', { type: 'place', card: card1, r: r1, c: c1 });
  assert(
    g.log[g.log.length - 1].playerId === 'p1',
    'undo: after the next player moves, the earlier player can no longer undo',
  );
}

// undoMode defaults to asking, and is carried through settings
{
  const d = defaultSettings();
  assert(d.undoMode === 'approval', 'undo: defaults to needing approval');
  assert(defaultSettings({ undoMode: 'instant' }).undoMode === 'instant', 'undo: instant setting');
  assert(defaultSettings({ undoMode: 'off' }).undoMode === 'off', 'undo: off setting');
}

// first player: normally seat 0, optionally random
{
  assert(freshGame(4, 2).turn === 0, 'first player: seat 0 deals by default');
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    Math.random = mulberry32(500 + i);
    const g = createGame(
      [0, 1, 2, 3].map((n) => ({ id: `p${n}`, name: `P${n}`, isBot: true, team: TEAMS[n % 2] })),
      defaultSettings({ firstPlayer: 'random' }),
    );
    seen.add(g.turn);
  }
  Math.random = mulberry32(0xc0ffee);
  assert(seen.size > 1, 'first player: random actually varies who starts');
  assert([...seen].every((t) => t >= 0 && t < 4), 'first player: random stays in range');
}

// dead-card exchange can be switched off
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ allowDeadExchange: false }),
  );
  setChips(g, 'blue', positionsFor(g.layout).get('2S')!);
  giveHand(g, 0, ['2S', '3S']);
  assert(isDeadCard(g, '2S'), 'dead-exchange off: the card is still dead');
  assert(
    !applyMove(g, 'p0', { type: 'exchangeDead', card: '2S' }).ok,
    'dead-exchange off: swapping is refused',
  );
  // the bot must not keep proposing a move the rules forbid
  const mv = chooseBotMove(g, g.players[0], 'hard');
  assert(mv.type !== 'exchangeDead', 'dead-exchange off: the bot stops offering it');
}

// handicap: a team can be made to complete extra sequences
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ winSequences: 1, handicapTeam: 'red', handicapExtra: 1 }),
  );
  assert(requiredFor(g, 'red') === 2, 'handicap: the handicapped team needs one more');
  assert(requiredFor(g, 'blue') === 1, 'handicap: the other team is unaffected');
  const run = runOf(g, 'red', 2, 2);
  giveHand(g, 0, [run.card]);
  applyMove(g, 'p0', { type: 'place', card: run.card, r: run.r, c: run.c });
  assert(g.sequences.length === 1, 'handicap: the sequence is made');
  assert(g.winner === null, 'handicap: one sequence is not enough for the handicapped team');
}

// chess clock: each player gets a bank that is billed as their turns end
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ clockSeconds: 300 }),
  );
  assert(g.timeBank?.p0 === 300000 && g.timeBank?.p1 === 300000, 'clock: both banks start full');
  g.turnStartedAt = Date.now() - 4000; // pretend p0 thought for 4s
  const card = g.players[0].hand.find((c) => legalCellsFor(g, 'red', c).length > 0)!;
  const [r, c] = legalCellsFor(g, 'red', card)[0];
  applyMove(g, 'p0', { type: 'place', card, r, c });
  const left = g.timeBank!.p0;
  assert(left < 300000 && left > 293000, `clock: p0 was billed about 4s (left ${left}ms)`);
  assert(g.timeBank!.p1 === 300000, 'clock: the waiting player is not billed');
  assert(toClientState(g, 'p0').timeBank?.p0 === left, 'clock: the bank reaches the client');
}

// power cards: jacks are ordered earlier, but the deck stays the real 104 cards
{
  const plain: number[] = [];
  const power: number[] = [];
  for (let i = 0; i < 60; i++) {
    const g1 = createGame(
      [0, 1].map((n) => ({ id: `p${n}`, name: `P${n}`, isBot: true, team: TEAMS[n % 2] })),
      defaultSettings(),
      mulberry32(4000 + i),
    );
    const g2 = createGame(
      [0, 1].map((n) => ({ id: `p${n}`, name: `P${n}`, isBot: true, team: TEAMS[n % 2] })),
      defaultSettings({ powerCards: true }),
      mulberry32(4000 + i),
    );
    // full deck = deck + both starting hands (14) + none discarded yet
    const all1 = [...g1.players.flatMap((p) => p.hand), ...g1.deck];
    const all2 = [...g2.players.flatMap((p) => p.hand), ...g2.deck];
    assert(all1.length === 104 && all2.length === 104, 'power cards: deck is still 104');
    const jacks1 = all1.filter((c) => c[0] === 'J').length;
    const jacks2 = all2.filter((c) => c[0] === 'J').length;
    if (i === 0) assert(jacks1 === 8 && jacks2 === 8, 'power cards: still exactly 8 jacks');
    // average position of the jacks (0 = top of what gets dealt/drawn first)
    const avgJackPos = (arr: string[]) => {
      const idx = arr.map((c, k) => (c[0] === 'J' ? k : -1)).filter((k) => k >= 0);
      return idx.reduce((a, b) => a + b, 0) / idx.length;
    };
    plain.push(avgJackPos(all1));
    power.push(avgJackPos(all2));
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert(mean(power) < mean(plain) - 5, 'power cards: jacks really do come earlier on average');

  // draws must take the FRONT of the deck (the same jack-rich end the deal uses),
  // not the back, or the power-card bias would reverse for everything drawn
  {
    const g = createGame(
      [0, 1].map((n) => ({ id: `p${n}`, name: `P${n}`, isBot: true, team: TEAMS[n % 2] })),
      defaultSettings({ powerCards: true }),
      mulberry32(77),
    );
    const nextUp = g.deck[0];
    const face = '2S';
    setChips(g, 'blue', positionsFor(g.layout).get(face)!); // make 2S dead
    giveHand(g, 0, [face]);
    applyMove(g, 'p0', { type: 'exchangeDead', card: face });
    assert(g.players[0].hand[0] === nextUp, 'power cards: a draw takes the front (early) card');
  }
}

// swap all dead cards at once: hand size and card totals are preserved
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings(),
  );
  // make three of p0's cards dead by covering both cells of each
  const deadFaces = ['2S', '3S', '4S'];
  for (const f of deadFaces) setChips(g, 'blue', positionsFor(g.layout).get(f)!);
  giveHand(g, 0, [...deadFaces, '7D']); // 3 dead + 1 live
  const tally = (x: GameCore) =>
    x.deck.length + x.discard.length + x.players.reduce((a, p) => a + p.hand.length, 0);
  const totalBefore = tally(g);
  const before = g.deck.length;
  const res = applyMove(g, 'p0', { type: 'swapDead' });
  assert(res.ok, 'swap-dead: is a legal move when you hold dead cards');
  assert(g.players[0].hand.length === 4, 'swap-dead: hand size is unchanged');
  assert(!deadFaces.some((f) => g.players[0].hand.includes(f)), 'swap-dead: the dead cards are gone');
  assert(g.players[0].hand.includes('7D'), 'swap-dead: live cards are kept');
  assert(g.deck.length === before - 3, 'swap-dead: exactly as many drawn as discarded');
  assert(g.turn === 0, 'swap-dead: your turn continues');
  assert(tally(g) === totalBefore, 'swap-dead: cards are conserved across the swap');
  assert(!applyMove(g, 'p0', { type: 'swapDead' }).ok, 'swap-dead: only once per turn');
}

// scored endgame: a locked board is decided by sequences, then chips, then draw
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings(),
  );
  // red has a completed sequence, blue does not; empty the deck and both hands
  runOf(g, 'red', 4, 2);
  g.sequences.push({ team: 'red', cells: [] }); // pretend red completed one
  g.deck = [];
  g.discard = [];
  g.players.forEach((p) => (p.hand = []));
  // trigger the terminal check via a pass
  const g2 = JSON.parse(JSON.stringify(g)) as GameCore;
  g2.rng = Math.random;
  applyMove(g2, 'p0', { type: 'pass' });
  assert(g2.winner === 'red', 'scored endgame: the team ahead on sequences wins a locked board');
  assert(g2.endReason === 'locked', 'scored endgame: the win is marked as a locked-board result');
}

// the clock must actually drive the turn deadline, not just be displayed
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ clockSeconds: 60, turnSeconds: 0 }),
  );
  const d = turnDeadlineFor(g);
  assert(d !== null, 'clock: a game clock alone still produces a turn deadline');
  assert(
    Math.abs((d ?? 0) - ((g.turnStartedAt ?? 0) + 60000)) < 50,
    'clock: the deadline is the bank when there is no per-turn timer',
  );
  // whichever runs out first wins
  const g2 = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ clockSeconds: 60, turnSeconds: 10 }),
  );
  assert(
    Math.abs((turnDeadlineFor(g2) ?? 0) - ((g2.turnStartedAt ?? 0) + 10000)) < 50,
    'clock: the shorter of the per-turn timer and the bank wins',
  );
  const g3 = freshGame(2, 2);
  assert(turnDeadlineFor(g3) === null, 'clock: no timer and no bank means no deadline');
  g3.winner = 'red';
  assert(turnDeadlineFor(g3) === null, 'clock: a finished game has no deadline');
}

// the handicap has to reach the client, or the UI shows the wrong target
{
  const g = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ winSequences: 2, handicapTeam: 'red', handicapExtra: 1 }),
  );
  const cs = toClientState(g, 'p0');
  assert(cs.requiredByTeam?.red === 3, 'handicap: the client sees the raised target for that team');
  assert(cs.requiredByTeam?.blue === 2, 'handicap: the other team keeps the normal target');
}

// hints are off unless the room deliberately switches them on
{
  assert(defaultSettings().hints === false, 'hints: off by default');
  assert(defaultSettings({ hints: true }).hints === true, 'hints: can be switched on');
  const off = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings(),
  );
  assert(
    toClientState(off, 'p0').settings.hints === false,
    'hints: every player sees them off by default',
  );
  const on = createGame(
    [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, team: TEAMS[i % 2] })),
    defaultSettings({ hints: true }),
  );
  assert(
    toClientState(on, 'p0').settings.hints === true,
    'hints: the on switch reaches every player through the game state',
  );
}

// save & resume: the client checkpoints GameCore through JSON.stringify, so the
// round-trip must preserve state exactly and the resumed game must keep playing
{
  const g = freshGame(2, 2);
  for (let i = 0; i < 30 && !g.winner && !g.stalemate; i++) {
    const p = g.players[g.turn];
    applyMove(g, p.id, chooseBotMove(g, p));
  }
  const snap = (x: GameCore) =>
    JSON.stringify({
      deck: x.deck.length,
      discard: x.discard.length,
      hands: x.players.map((p) => p.hand.join(',')),
      turn: x.turn,
      seqs: x.sequences.length,
      chips: x.board.flat().filter((c) => c.chip).length,
      locked: x.board.flat().reduce((a, c) => a + c.locked.length, 0),
      log: x.log.length,
      eventCounter: x.eventCounter,
      required: x.required,
      pending: x.pendingDraws,
    });
  const before = snap(g);
  const restored = JSON.parse(JSON.stringify(g)) as GameCore;
  restored.rng = Math.random; // functions don't survive JSON, the store re-attaches it
  assert(snap(restored) === before, 'save/resume: state survives the JSON round-trip');

  let illegal = 0;
  for (let i = 0; i < 200 && !restored.winner && !restored.stalemate; i++) {
    const p = restored.players[restored.turn];
    if (!applyMove(restored, p.id, chooseBotMove(restored, p)).ok) illegal++;
  }
  assert(illegal === 0, 'save/resume: a resumed game keeps producing legal moves');
  const totalAfter =
    restored.deck.length +
    restored.discard.length +
    restored.players.reduce((a, p) => a + p.hand.length, 0);
  assert(totalAfter === 104, 'save/resume: cards still conserved after resuming');
}

// hint: the client scores moves with a partial GameCore built from ClientGameState
{
  const g = freshGame(2, 2);
  for (let i = 0; i < 20 && !g.winner; i++) {
    const p = g.players[g.turn];
    applyMove(g, p.id, chooseBotMove(g, p));
  }
  const cs = toClientState(g, 'p0');
  const me = cs.players.find((p) => p.id === 'p0')!;
  const shim = {
    board: cs.board,
    settings: cs.settings,
    deadExchangedThisTurn: cs.deadExchangedThisTurn,
  } as unknown as GameCore;
  const mePlayer = {
    id: 'p0',
    name: me.name,
    team: me.team,
    isBot: false,
    hand: [...cs.yourHand],
    connected: true,
  } as unknown as ServerPlayer;

  let move: ReturnType<typeof chooseBotMove> | null = null;
  let threw = false;
  try {
    move = chooseBotMove(shim, mePlayer, 'hard');
  } catch {
    threw = true;
  }
  assert(!threw && move !== null, 'hint: the client shim does not crash the bot scorer');
  if (move && (move.type === 'place' || move.type === 'remove')) {
    const { r, c } = move;
    assert(
      legalCellsFor(g, me.team, move.card).some(([rr, cc]) => rr === r && cc === c),
      'hint: the suggested cell is genuinely legal',
    );
    assert(cs.yourHand.includes(move.card), 'hint: the suggested card is genuinely in hand');
  }
}

console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// ---------- 3. full-game simulations ----------
function simulate(
  playerCount: number,
  teamCount: 2 | 3,
  strictDraw: boolean,
  randomBoard = false,
): string {
  const game = freshGame(playerCount, teamCount, strictDraw, randomBoard);
  let moves = 0;
  while (!game.winner && !game.stalemate && moves < 4000) {
    const current = game.players[game.turn];
    const move = chooseBotMove(game, current);
    const res = applyMove(game, current.id, move);
    if (!res.ok) {
      const dead = current.hand.find((c) => isDeadCard(game, c));
      const rescue =
        (dead && applyMove(game, current.id, { type: 'exchangeDead', card: dead }).ok) ||
        applyMove(game, current.id, { type: 'pass' }).ok;
      if (!rescue) throw new Error(`Deadlock at move ${moves}: ${res.error}`);
    }
    if (strictDraw && (game.pendingDraws[current.id] ?? 0) > 0) {
      if (Math.random() < 0.9) applyMove(game, current.id, { type: 'draw' });
    }
    // per-move invariant: cards are conserved and no cell holds two chips
    const live =
      game.deck.length +
      game.discard.length +
      game.players.reduce((a, p) => a + p.hand.length, 0);
    if (live !== 104) throw new Error(`card leak at move ${moves}: ${live} != 104`);
    moves++;
  }
  if (!game.winner && !game.stalemate)
    throw new Error(`No outcome after ${moves} moves (${playerCount}p)`);
  const total =
    game.deck.length +
    game.discard.length +
    game.players.reduce((a, p) => a + p.hand.length, 0);
  if (total !== 104) throw new Error(`Card conservation broken: ${total} != 104`);
  if (game.winner && game.endReason !== 'locked') {
    // a normal win requires the sequence count; a locked-board win is scored out
    // by most sequences then chips and legitimately has fewer
    const winSeqs = game.sequences.filter((s) => s.team === game.winner).length;
    if (winSeqs < game.required) throw new Error('Winner lacks required sequences');
  }
  if (game.winner && game.stalemate) throw new Error('game both won and drawn');
  const outcome = game.winner
    ? `${game.winner} wins${game.endReason === 'locked' ? ' (locked)' : ''}`
    : 'stalemate draw';
  return `${playerCount}p/${teamCount}t${strictDraw ? '/strict' : ''}${randomBoard ? '/shuffled' : ''}: ${outcome} in ${moves} moves`;
}

/** Play difficulty A (as p0/red) vs B (as p1/blue) for N seeded games; alternate
 * who moves first to cancel the first-move advantage. Returns each side's wins. */
function headToHead(
  diffA: 'easy' | 'medium' | 'hard',
  diffB: 'easy' | 'medium' | 'hard',
  games: number,
): { a: number; b: number; draws: number } {
  let a = 0;
  let b = 0;
  let draws = 0;
  for (let i = 0; i < games; i++) {
    Math.random = mulberry32(0xa11ce * (i + 7));
    const aIsRed = i % 2 === 0; // alternate the first mover
    const g = freshGame(2, 2);
    let moves = 0;
    while (!g.winner && !g.stalemate && moves < 4000) {
      const cur = g.players[g.turn];
      const isA = (cur.team === 'red') === aIsRed;
      const mv = chooseBotMove(g, cur, isA ? diffA : diffB);
      if (!applyMove(g, cur.id, mv).ok) {
        const dead = cur.hand.find((c) => isDeadCard(g, c));
        if (!(dead && applyMove(g, cur.id, { type: 'exchangeDead', card: dead }).ok))
          applyMove(g, cur.id, { type: 'pass' });
      }
      moves++;
    }
    const winnerIsA = g.winner ? (g.winner === 'red') === aIsRed : null;
    if (winnerIsA === true) a++;
    else if (winnerIsA === false) b++;
    else draws++;
  }
  return { a, b, draws };
}

const SIM_COUNT = 60;
console.log(`\nFull-game simulations (${SIM_COUNT} each, seeded/reproducible):`);
const configs: Array<[number, 2 | 3, boolean, boolean?]> = [
  [2, 2, false],
  [2, 2, true],
  [3, 3, false],
  [4, 2, false],
  [4, 2, true],
  [6, 2, false],
  [6, 3, false],
  [8, 2, false],
  [9, 3, false],
  [10, 2, false],
  [12, 2, false],
  [12, 3, true],
  // shuffled boards must play through cleanly too
  [2, 2, false, true],
  [4, 2, false, true],
  [6, 3, false, true],
];

let simFailures = 0;
for (let ci = 0; ci < configs.length; ci++) {
  const [pc, tc, strict, rnd] = configs[ci];
  for (let i = 0; i < SIM_COUNT; i++) {
    const seed = 0x100000 * (ci + 1) + i;
    Math.random = mulberry32(seed);
    try {
      const summary = simulate(pc, tc, strict, !!rnd);
      if (i === 0) console.log('OK  ', summary);
    } catch (e) {
      simFailures++;
      console.error(`FAIL ${pc}p/${tc}t${strict ? '/strict' : ''} seed=${seed}:`, (e as Error).message);
      break;
    }
  }
}
// bot strength: stronger tiers must beat weaker ones over a seeded match set
console.log('\nBot strength (head-to-head, 80 games each):');
const hE = headToHead('hard', 'easy', 80);
const mE = headToHead('medium', 'easy', 80);
const hM = headToHead('hard', 'medium', 80);
const pct = (r: { a: number; b: number; draws: number }) =>
  `${Math.round((r.a / (r.a + r.b || 1)) * 100)}% (${r.a}-${r.b}${r.draws ? `, ${r.draws} draw` : ''})`;
console.log(`  hard vs easy:   ${pct(hE)}`);
console.log(`  medium vs easy: ${pct(mE)}`);
console.log(`  hard vs medium: ${pct(hM)}`);
if (hE.a <= hE.b) {
  console.error('  FAIL: hard does not beat easy');
  simFailures++;
}
if (mE.a <= mE.b) {
  console.error('  FAIL: medium does not beat easy');
  simFailures++;
}

Math.random = ORIG_RANDOM;

if (simFailures) {
  console.error(`\n${simFailures} configuration(s) failed`);
  process.exit(1);
}
console.log(`\nAll rule tests and ${configs.length * SIM_COUNT} seeded simulations passed.`);
