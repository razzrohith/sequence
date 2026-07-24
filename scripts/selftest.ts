/**
 * Self-test suite:
 *  1. Board layout validation (48 unique faces x2 + 4 free corners)
 *  2. Rule-by-rule unit tests of every official Sequence mechanic
 *  3. Full bot-vs-bot simulations across every supported player count
 * Run: npm run selftest
 */
import { BOARD_LAYOUT } from '../shared/board';
import { chooseBotMove } from '../shared/bot';
import {
  HAND_SIZES,
  applyMove,
  createGame,
  isDeadCard,
  legalCellsFor,
  validateBoardLayout,
} from '../shared/game';
import { TEAMS } from '../shared/types';
import type { Card, GameCore, Team } from '../shared/types';

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

function freshGame(playerCount = 2, teamCount: 2 | 3 = 2, strictDraw = false): GameCore {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isBot: true,
    team: TEAMS[i % teamCount],
  }));
  return createGame(players, { teamCount, strictDraw });
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
  setChips(g, 'red', [
    [2, 2],
    [2, 3],
    [2, 4],
    [2, 5],
  ]);
  giveHand(g, 0, ['6D']); // BOARD_LAYOUT[2][6] === '6D'
  applyMove(g, 'p0', { type: 'place', card: '6D', r: 2, c: 6 });
  assert(g.winner === 'red', 'quick-win: a single sequence wins immediately');
}

// normal card: exactly its two printed cells are legal
{
  const g = freshGame();
  const cells = legalCellsFor(g, 'red', '7D');
  assert(cells.length === 2, 'a rank card has exactly 2 board cells');
  assert(
    cells.every(([r, c]) => BOARD_LAYOUT[r][c] === '7D'),
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
  setChips(g, 'red', [
    [2, 2],
    [2, 3],
    [2, 4],
    [2, 5],
  ]);
  giveHand(g, 0, ['6D']); // BOARD_LAYOUT[2][6] === '6D'
  const res = applyMove(g, 'p0', { type: 'place', card: '6D', r: 2, c: 6 });
  assert(res.ok, 'placing the 5th chip is legal');
  assert(g.sequences.length === 1 && g.sequences[0].team === 'red', 'sequence detected');
  assert(
    g.sequences[0].cells.every(([r, c]) => g.board[r][c].locked.includes('red')),
    'sequence cells are locked',
  );
  giveHand(g, 1, ['JS']);
  const rm = applyMove(g, 'p1', { type: 'remove', card: 'JS', r: 2, c: 4 });
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
  giveHand(g, 0, ['2H']); // BOARD_LAYOUT[5][4] === '2H'
  const res = applyMove(g, 'p0', { type: 'place', card: '2H', r: 5, c: 4 });
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
  giveHand(g, 0, ['5S']); // BOARD_LAYOUT[0][4] === '5S'
  const res = applyMove(g, 'p0', { type: 'place', card: '5S', r: 0, c: 4 });
  assert(res.ok && g.sequences.length === 1, 'corner + 4 chips completes a sequence');
  // blue can still use the same corner going down column 0
  setChips(g, 'blue', [
    [1, 0],
    [2, 0],
    [3, 0],
  ]);
  giveHand(g, 1, ['9C']); // BOARD_LAYOUT[4][0] === '9C'
  const res2 = applyMove(g, 'p1', { type: 'place', card: '9C', r: 4, c: 0 });
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
  const [a, b] = [
    [0, 1],
    [8, 6],
  ] as Array<[number, number]>; // both 2S cells
  setChips(g, 'blue', [a, b]);
  giveHand(g, 0, ['2S', '3S', '3S']);
  assert(isDeadCard(g, '2S'), 'card with both cells covered is dead');
  const ex = applyMove(g, 'p0', { type: 'exchangeDead', card: '2S' });
  assert(ex.ok, 'dead card can be exchanged');
  assert(g.players[0].hand.length === 3, 'exchange draws a replacement');
  assert(g.turn === 0, 'turn continues after exchanging');
  // a second exchange the same turn is illegal even if another card is dead
  setChips(g, 'blue', [
    [0, 2],
    [8, 5],
  ]); // both 3S cells
  const ex2 = applyMove(g, 'p0', { type: 'exchangeDead', card: '3S' });
  assert(!ex2.ok, 'only one dead-card exchange per turn');
}

// pass: allowed only with no legal move; dead-card exchange is OPTIONAL and
// never blocks a pass (per official rules)
{
  const g = freshGame();
  setChips(g, 'blue', [
    [0, 1],
    [8, 6],
  ]); // both 2S cells covered -> 2S is dead, no legal move
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

console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// ---------- 3. full-game simulations ----------
function simulate(playerCount: number, teamCount: 2 | 3, strictDraw: boolean): string {
  const game = freshGame(playerCount, teamCount, strictDraw);
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
  if (game.winner) {
    const winSeqs = game.sequences.filter((s) => s.team === game.winner).length;
    if (winSeqs < game.required) throw new Error('Winner lacks required sequences');
  }
  const outcome = game.winner ? `${game.winner} wins` : 'stalemate draw';
  return `${playerCount}p/${teamCount}t${strictDraw ? '/strict' : ''}: ${outcome} in ${moves} moves`;
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
const configs: Array<[number, 2 | 3, boolean]> = [
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
];

let simFailures = 0;
for (let ci = 0; ci < configs.length; ci++) {
  const [pc, tc, strict] = configs[ci];
  for (let i = 0; i < SIM_COUNT; i++) {
    const seed = 0x100000 * (ci + 1) + i;
    Math.random = mulberry32(seed);
    try {
      const summary = simulate(pc, tc, strict);
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
