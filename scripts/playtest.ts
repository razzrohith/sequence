/**
 * Headless multiplayer play-tester.
 *
 * Connects to the RUNNING server as real socket.io clients and plays full
 * games through the actual network + room layer (not the in-process engine).
 * Catches the class of bugs unit tests miss: desyncs, illegal-move rejections,
 * hangs/livelocks, reconnect/autopilot failures, host migration, card leaks.
 *
 * Usage:  npx tsx scripts/playtest.ts [url]
 *         SEQ_URL=http://localhost:3001 npx tsx scripts/playtest.ts
 */
import { io, type Socket } from 'socket.io-client';
import {
  isDeadOnBoard,
  isOneEyed,
  isTwoEyed,
  legalCellsOnBoard,
} from '../shared/game';
import type { ClientGameState, EmoteMessage, Move, RoomInfo } from '../shared/types';

const URL = process.argv[2] || process.env.SEQ_URL || 'http://localhost:3001';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label);
    console.error('   ✗', label);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let idc = 0;
const newId = () => `pt-${Date.now().toString(36)}-${idc++}`;

/** A scripted player: wraps a socket, tracks its own latest gameState/room. */
class Client {
  socket: Socket;
  playerId: string;
  name: string;
  room: RoomInfo | null = null;
  gs: ClientGameState | null = null;
  lastError: string | null = null;
  drewFor = -1;
  code: string | null = null;
  token: string | null = null;
  emotes: EmoteMessage[] = [];
  spectating = false;

  constructor(name: string, playerId = newId()) {
    this.name = name;
    this.playerId = playerId;
    this.socket = io(URL, { transports: ['websocket'], forceNew: true });
    this.socket.on('roomUpdate', (r: RoomInfo) => (this.room = r));
    this.socket.on('roomJoined', (d: { code: string; token?: string }) => {
      this.code = d.code;
      // capture the reconnect secret at the source: roomJoined fires the instant
      // create()/join() lands, before a scenario could attach its own listener
      if (d.token) this.token = d.token;
    });
    this.socket.on('spectating', (d: { code: string }) => {
      this.code = d.code;
      this.spectating = true;
    });
    this.socket.on('emote', (m: EmoteMessage) => this.emotes.push(m));
    this.socket.on('gameState', (g: ClientGameState) => {
      this.gs = g;
      // strict draw: claim owed draws promptly (dedupe per event; never after
      // the game has ended, or the server correctly rejects it)
      if (
        g.yourPendingDraws > 0 &&
        !g.winner &&
        !g.stalemate &&
        this.lastMoveN() !== this.drewFor
      ) {
        this.drewFor = this.lastMoveN();
        this.socket.emit('playMove', { type: 'draw' } as Move);
      }
    });
    this.socket.on('errorMsg', (m: string) => (this.lastError = m));
  }

  lastMoveN(): number {
    return this.gs?.lastMove?.n ?? 0;
  }
  connected() {
    return this.socket.connected;
  }
  waitConnect() {
    return new Promise<void>((res) => {
      if (this.socket.connected) return res();
      this.socket.once('connect', () => res());
    });
  }
  create() {
    this.socket.emit('createRoom', { name: this.name, playerId: this.playerId });
  }
  quickPlay(players: number) {
    this.socket.emit('quickPlay', { name: this.name, playerId: this.playerId, players });
  }
  join(code: string) {
    this.socket.emit('joinRoom', { code, name: this.name, playerId: this.playerId });
  }
  addBot() {
    this.socket.emit('addBot');
  }
  setSettings(s: {
    teamCount?: number;
    strictDraw?: boolean;
    botDifficulty?: string;
    turnSeconds?: number;
  }) {
    this.socket.emit('updateSettings', s);
  }
  spectate(code: string) {
    this.socket.emit('joinSpectate', { code, name: this.name, playerId: this.playerId });
  }
  emote(e: string) {
    this.socket.emit('emote', { emote: e });
  }
  requestUndo() {
    this.socket.emit('requestUndo');
  }
  respondUndo(approve: boolean) {
    this.socket.emit('respondUndo', { approve });
  }
  start() {
    this.socket.emit('startGame');
  }
  leave() {
    this.socket.emit('leaveRoom');
  }
  rematch() {
    this.socket.emit('rematch');
  }
  kill() {
    this.socket.disconnect();
  }

  /** Compute and emit one legal move from this client's own view. */
  act(): 'moved' | 'nomove' {
    const g = this.gs;
    if (!g) return 'nomove';
    const me = g.players.find((p) => p.id === g.yourId);
    if (!me) return 'nomove';
    const hand = [...new Set(g.yourHand)];

    // prefer normal cards, then two-eyed (wild), then one-eyed (remove)
    const order = hand.sort((a, b) => rank(a) - rank(b));
    for (const card of order) {
      if (isOneEyed(card)) {
        const cells = legalCellsOnBoard(g.board, me.team, card);
        if (cells.length) {
          this.emit({ type: 'remove', card, r: cells[0][0], c: cells[0][1] });
          return 'moved';
        }
        continue;
      }
      const cells = legalCellsOnBoard(g.board, me.team, card);
      if (cells.length) {
        this.emit({ type: 'place', card, r: cells[0][0], c: cells[0][1] });
        return 'moved';
      }
    }
    // no placement: exchange a dead card if allowed, else pass
    if (!g.deadExchangedThisTurn) {
      const dead = g.yourHand.find((c) => isDeadOnBoard(g.board, c));
      if (dead) {
        this.emit({ type: 'exchangeDead', card: dead });
        return 'moved';
      }
    }
    this.emit({ type: 'pass' });
    return 'moved';
  }

  emit(m: Move) {
    this.lastError = null;
    this.socket.emit('playMove', m);
  }
}

function rank(card: string): number {
  if (isTwoEyed(card)) return 2;
  if (isOneEyed(card)) return 3;
  return 1;
}

async function waitFor(pred: () => boolean, ms: number, step = 25): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(step);
  }
  return pred();
}

/** Drive a started game to completion via a reference client's global view. */
async function driveToEnd(ref: Client, byId: Record<string, Client>, tag: string) {
  const over = () => !!ref.gs?.winner || !!ref.gs?.stalemate;
  let guard = 0;
  await waitFor(() => !!ref.gs, 3000);
  while (!over() && guard < 4000) {
    const g = ref.gs!;
    const cur = g.players[g.turn]?.id;
    const client = byId[cur];
    const before = ref.lastMoveN();
    if (!client) {
      // current player is a server-driven bot (or an autopiloted seat) -
      // wait for the server to advance the turn rather than driving it here
      const progressed = await waitFor(() => ref.lastMoveN() > before || over(), 6000);
      if (!progressed) {
        check(false, `${tag}: bot/AI turn stalled at seat ${g.turn}`);
        return;
      }
      guard++;
      continue;
    }
    const acted = client.act();
    if (acted === 'nomove') {
      await sleep(30);
    } else {
      const progressed = await waitFor(() => ref.lastMoveN() > before || over(), 4000);
      if (!progressed) {
        check(false, `${tag}: game stalled at turn ${g.turn} (last error: ${client.lastError})`);
        return;
      }
      // "not your turn" and end-of-game races are benign in a fast test client
      if (client.lastError && !/not your turn|game is over/i.test(client.lastError)) {
        check(false, `${tag}: unexpected move rejection "${client.lastError}"`);
        return;
      }
    }
    guard++;
  }
  check(over(), `${tag}: game reached an outcome (${guard} steps)`);
  // The outcome must be internally consistent whether the game ended in a win or
  // a stalemate. Assert exactly one condition either way, so the assertion count
  // stays deterministic run to run (a win vs. a stalemate no longer changes how
  // many checks fire) and stalemate endings get covered too.
  const gs = ref.gs;
  const w = gs?.winner;
  let outcomeOk: boolean;
  let how: string;
  if (w) {
    const mine = gs!.sequences.filter((s) => s.team === w).length;
    if (gs!.endReason === 'locked') {
      // a jammed board is scored on sequences then chips, so the winner may hold
      // fewer than `required` — it just has to lead (or tie) every other team
      const teams = [...new Set(gs!.players.map((p) => p.team))];
      const best = Math.max(
        0,
        ...teams.filter((t) => t !== w).map((t) => gs!.sequences.filter((s) => s.team === t).length),
      );
      outcomeOk = mine >= best;
      how = 'locked winner leads on sequences';
    } else {
      outcomeOk = mine >= gs!.required;
      how = 'winner has required sequences';
    }
  } else {
    outcomeOk = !!gs?.stalemate;
    how = 'stalemate';
  }
  check(outcomeOk, `${tag}: outcome consistent (${how})`);
}

// ---------- scenarios ----------

async function scenarioFullGame(n: number, teams: 2 | 3, strict: boolean) {
  const tag = `full ${n}p/${teams}t${strict ? '/strict' : ''}`;
  const clients: Client[] = [];
  const host = new Client('Host');
  clients.push(host);
  await host.waitConnect();
  host.create();
  const gotRoom = await waitFor(() => !!host.room, 3000);
  check(gotRoom, `${tag}: room created`);
  const code = host.room!.code;

  for (let i = 1; i < n; i++) {
    const c = new Client(`P${i}`);
    await c.waitConnect();
    c.join(code);
    clients.push(c);
  }
  await waitFor(() => (host.room?.players.length ?? 0) === n, 3000);
  check(host.room?.players.length === n, `${tag}: all ${n} players joined`);

  host.setSettings({ teamCount: teams, strictDraw: strict });
  await sleep(120);
  host.start();
  const started = await waitFor(() => clients.every((c) => !!c.gs), 3000);
  check(started, `${tag}: game started for everyone`);

  // every client should see the same board dimensions and turn
  check(
    clients.every((c) => c.gs?.board.length === 10 && c.gs.turn === host.gs!.turn),
    `${tag}: all clients in sync at start`,
  );

  const byId: Record<string, Client> = {};
  for (const c of clients) byId[c.playerId] = c;
  await driveToEnd(host, byId, tag);

  clients.forEach((c) => c.kill());
  await sleep(80);
}

async function scenarioQuickPlay() {
  const tag = 'quickPlay solo vs bot';
  const c = new Client('Solo');
  await c.waitConnect();
  c.quickPlay(2);
  const started = await waitFor(() => !!c.gs && c.gs.players.length === 2, 3000);
  check(started, `${tag}: dealt straight into a 2-player game`);
  check(c.gs?.players.some((p) => p.isBot), `${tag}: opponent is a bot`);
  const byId = { [c.playerId]: c };
  await driveToEnd(c, byId, tag);
  c.kill();
  await sleep(80);
}

async function scenarioReconnect() {
  const tag = 'reconnect mid-game';
  const host = new Client('RcHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const guest = new Client('RcGuest');
  await guest.waitConnect();
  guest.join(code);
  await waitFor(() => host.room?.players.length === 2, 3000);
  host.start();
  await waitFor(() => !!guest.gs, 3000);

  const savedId = guest.playerId;
  const handBefore = guest.gs!.yourHand.length;
  guest.kill();
  await sleep(300);

  // reconnect with the same playerId
  const back = new Client('RcGuest', savedId);
  await back.waitConnect();
  back.join(code);
  const restored = await waitFor(() => !!back.gs && back.gs.yourHand.length > 0, 3000);
  check(restored, `${tag}: rejoined and hand restored`);
  check(back.gs?.yourHand.length === handBefore, `${tag}: same hand size after rejoin`);
  const meRejoined = back.gs?.players.find((p) => p.id === savedId);
  check(meRejoined?.isBot === false, `${tag}: AI autopilot cleared on rejoin`);

  host.kill();
  back.kill();
  await sleep(80);
}

async function scenarioAutopilotOnLeave() {
  const tag = 'AI takes over on leave';
  const host = new Client('ApHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const guest = new Client('ApGuest');
  await guest.waitConnect();
  guest.join(code);
  await waitFor(() => host.room?.players.length === 2, 3000);
  host.start();
  await waitFor(() => !!host.gs, 3000);
  const guestId = guest.playerId;
  guest.leave();
  guest.kill();
  await sleep(300);
  const tookOver = await waitFor(
    () => host.gs?.players.find((p) => p.id === guestId)?.isBot === true,
    3000,
  );
  check(tookOver, `${tag}: departed player flagged as bot`);
  // the game must still be able to finish with the AI driving the empty seat
  const byId = { [host.playerId]: host };
  await driveToEnd(host, byId, tag);
  host.kill();
  await sleep(80);
}

async function scenarioHostMigration() {
  const tag = 'host migration in lobby';
  const host = new Client('MigHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const guest = new Client('MigGuest');
  await guest.waitConnect();
  guest.join(code);
  await waitFor(() => guest.room?.players.length === 2, 3000);
  const guestId = guest.playerId;
  host.leave();
  host.kill();
  const migrated = await waitFor(() => guest.room?.hostId === guestId, 3000);
  check(migrated, `${tag}: remaining player became host`);
  guest.kill();
  await sleep(80);
}

async function scenarioIllegalMoves() {
  const tag = 'illegal-move guards';
  const c = new Client('Cheater');
  await c.waitConnect();
  c.quickPlay(2);
  await waitFor(() => !!c.gs, 3000);
  // try to place a card not in hand on a random cell
  c.lastError = null;
  c.socket.emit('playMove', { type: 'place', card: 'JS', r: 0, c: 0 });
  const rejected = await waitFor(() => !!c.lastError, 1500);
  check(rejected, `${tag}: server rejected an illegal move`);
  c.kill();
  await sleep(80);
}

async function scenarioMalformedPayloads() {
  const tag = 'malformed payloads do not crash the server';
  const attacker = new Client('Attacker');
  await attacker.waitConnect();
  // fire every known garbage shape at every handler
  const s = attacker.socket;
  s.emit('createRoom', null);
  s.emit('createRoom');
  s.emit('quickPlay', 42);
  s.emit('joinRoom');
  s.emit('joinRoom', null);
  s.emit('joinRoom', { code: 12345 });
  s.emit('updateSettings', null);
  s.emit('removePlayer', 'not-an-object');
  s.emit('addBot', null);
  s.emit('startGame', null);
  s.emit('chat', 999);
  s.emit('chat', { text: { nested: true } });
  s.emit('playMove', null);
  s.emit('playMove');
  s.emit('playMove', 'place');
  s.emit('playMove', { type: 'place', card: 'JD' }); // missing r/c
  s.emit('playMove', { type: 'place', card: 'JD', r: 2.5, c: 'x' });
  s.emit('playMove', { type: 'remove', card: 'JS' });
  s.emit('rematch', null);
  s.emit('leaveRoom', null);
  await sleep(400);

  // prove the server is still alive: a fresh client can create and start a game
  const survivor = new Client('Survivor');
  await survivor.waitConnect();
  survivor.quickPlay(2);
  const alive = await waitFor(() => !!survivor.gs, 3000);
  check(alive, `${tag}: server still serving new games after the attack`);
  attacker.kill();
  survivor.kill();
  await sleep(80);
}

async function scenarioSeatHijack() {
  const tag = 'seat hijack rejected';
  const host = new Client('HjHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const guest = new Client('HjGuest');
  await guest.waitConnect();
  guest.join(code);
  await waitFor(() => host.room?.players.length === 2, 3000);

  // attacker knows the guest's public id but not the secret token
  const attacker = new Client('Attacker', guest.playerId);
  await attacker.waitConnect();
  attacker.lastError = null;
  attacker.socket.emit('joinRoom', { code, name: 'Attacker', playerId: guest.playerId, token: 'wrong' });
  const rejected = await waitFor(() => !!attacker.lastError, 2000);
  check(rejected, `${tag}: join with a wrong token was refused`);
  // the legitimate guest is still seated and connected
  await sleep(200);
  const guestSeat = host.room?.players.find((p) => p.id === guest.playerId);
  check(guestSeat?.connected === true, `${tag}: original occupant keeps the seat`);

  host.kill();
  guest.kill();
  attacker.kill();
  await sleep(80);
}

async function scenarioLobbyRefresh() {
  const tag = 'lobby refresh keeps seat';
  const host = new Client('RefHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const savedId = host.playerId;
  // the reconnect token the server issued (captured by the Client on roomJoined)
  const token = host.token ?? '';
  check(!!token, `${tag}: host received a reconnect token`);
  await sleep(150);

  // simulate a browser refresh: drop the socket, then rejoin within the grace
  // window, presenting the saved token so the server authenticates the reclaim
  host.kill();
  await sleep(500);
  const back = new Client('RefHost', savedId);
  await back.waitConnect();
  back.socket.emit('joinRoom', { code, name: 'RefHost', playerId: savedId, token });
  const restored = await waitFor(() => !!back.room, 3000);
  check(restored, `${tag}: room survived the refresh and rejoin`);
  check(back.room?.hostId === savedId, `${tag}: host status preserved across refresh`);
  back.kill();
  await sleep(80);
}

async function scenarioSpectator() {
  const tag = 'spectator mode';
  const host = new Client('SpecHost');
  await host.waitConnect();
  host.quickPlay(2); // solo vs 1 bot
  await waitFor(() => !!host.gs && !!host.code, 3000);
  const code = host.code!;
  const watcher = new Client('Watcher');
  await watcher.waitConnect();
  watcher.spectate(code);
  const watching = await waitFor(() => watcher.spectating && !!watcher.gs, 3000);
  check(watching, `${tag}: spectator receives game state`);
  check(watcher.gs?.spectator === true, `${tag}: flagged as spectator`);
  check((watcher.gs?.yourHand.length ?? 99) === 0, `${tag}: spectator sees no hand`);
  check((host.gs?.spectatorCount ?? 0) >= 1, `${tag}: player sees the watcher count`);
  host.kill();
  watcher.kill();
  await sleep(80);
}

async function scenarioTurnTimer() {
  const tag = 'turn timer auto-plays';
  const host = new Client('TtHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  host.addBot();
  await sleep(150);
  host.setSettings({ teamCount: 2, turnSeconds: 1 });
  await sleep(150);
  host.start();
  await waitFor(() => !!host.gs, 3000);
  // the host never acts; the shot clock must auto-play its turns. Assert the
  // game PROGRESSES on its own (several moves) rather than waiting for the full
  // ~1s-per-turn game to finish.
  const startN = host.lastMoveN();
  await waitFor(() => host.lastMoveN() >= startN + 4 || !!host.gs?.winner, 12000);
  const progressed = host.lastMoveN() >= startN + 4 || !!host.gs?.winner;
  check(progressed, `${tag}: turns auto-play with no human input`);
  host.kill();
  await sleep(80);
}

async function scenarioEmote() {
  const tag = 'emotes broadcast';
  const host = new Client('EmHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const guest = new Client('EmGuest');
  await guest.waitConnect();
  guest.join(code);
  await waitFor(() => host.room?.players.length === 2, 3000);
  host.start();
  await waitFor(() => !!host.gs, 3000);
  guest.emote('🔥');
  const got = await waitFor(() => host.emotes.some((e) => e.emote === '🔥'), 2000);
  check(got, `${tag}: other players receive the emote`);
  host.kill();
  guest.kill();
  await sleep(80);
}

async function scenarioUndo() {
  const tag = 'undo request/approve';
  const host = new Client('UnHost');
  await host.waitConnect();
  host.create();
  await waitFor(() => !!host.room, 3000);
  const code = host.room!.code;
  const guest = new Client('UnGuest');
  await guest.waitConnect();
  guest.join(code);
  await waitFor(() => host.room?.players.length === 2, 3000);
  host.start();
  await waitFor(() => !!host.gs && !!guest.gs, 3000);

  const byId: Record<string, Client> = { [host.playerId]: host, [guest.playerId]: guest };
  // whoever's turn it is makes exactly one placement
  const g = host.gs!;
  const mover = byId[g.players[g.turn].id];
  const other = mover === host ? guest : host;
  const chipsBefore = g.board.flat().filter((c) => c.chip).length;
  const before = mover.lastMoveN();
  mover.act();
  await waitFor(() => mover.lastMoveN() > before, 3000);
  const chipsAfter = (mover.gs?.board.flat().filter((c) => c.chip).length) ?? 0;
  check(chipsAfter === chipsBefore + 1, `${tag}: a chip was placed`);
  // mover asks to undo; the other player approves
  mover.requestUndo();
  await waitFor(() => !!other.gs?.undoRequest, 2000);
  check(!!other.gs?.undoRequest, `${tag}: opponent sees the undo request`);
  other.respondUndo(true);
  await waitFor(
    () => (mover.gs?.board.flat().filter((c) => c.chip).length ?? -1) === chipsBefore,
    3000,
  );
  const reverted = (mover.gs?.board.flat().filter((c) => c.chip).length ?? -1) === chipsBefore;
  check(reverted, `${tag}: approved undo reverted the move`);
  host.kill();
  guest.kill();
  await sleep(80);
}

// ---------- runner ----------

async function main() {
  console.log(`Play-testing server at ${URL}\n`);
  // fail fast if the server is unreachable
  const probe = new Client('Probe');
  const up = await waitFor(() => probe.connected(), 4000);
  probe.kill();
  if (!up) {
    console.error(`Cannot reach server at ${URL}. Start it first (npm start).`);
    process.exit(2);
  }

  const configs: Array<[number, 2 | 3, boolean]> = [
    [2, 2, false],
    [2, 2, true],
    [3, 3, false],
    [4, 2, false],
    [4, 2, true],
    [6, 2, false],
    [6, 3, false],
  ];

  console.log('Full networked games:');
  for (const [n, t, s] of configs) {
    await scenarioFullGame(n, t, s);
  }
  console.log('\nLifecycle scenarios:');
  await scenarioQuickPlay();
  await scenarioReconnect();
  await scenarioAutopilotOnLeave();
  await scenarioHostMigration();
  await scenarioIllegalMoves();

  console.log('\nSecurity / robustness scenarios:');
  await scenarioMalformedPayloads();
  await scenarioSeatHijack();
  await scenarioLobbyRefresh();

  console.log('\nFeature scenarios:');
  await scenarioSpectator();
  await scenarioTurnTimer();
  await scenarioEmote();
  await scenarioUndo();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
  }
  console.log('All networked play-tests passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('play-test crashed:', e);
  process.exit(1);
});
