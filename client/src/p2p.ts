// Peer-to-peer multiplayer transport (WebRTC via PeerJS free cloud signaling).
//
// One player (the room creator) is the HOST: their browser runs the authoritative
// game engine — exactly the same shared code the dedicated server uses — and
// relays state to the other players over WebRTC data channels. Guests send their
// moves to the host. This lets "Play with friends" work from a purely static
// deploy (GitHub Pages) with no backend to host.
//
// Reliability note: WebRTC needs to traverse NAT; the free PeerJS cloud provides
// STUN but not TURN, so a small fraction of strict/corporate networks may fail to
// connect. For those, a dedicated server is the fallback.
import Peer, { type DataConnection } from 'peerjs';
import { chooseBotMove } from '../../shared/bot';
import {
  HAND_SIZES,
  applyMove,
  createGame,
  defaultSettings,
  forceLegalMove,
  isDeadCard,
  teamOptionsFor,
  toClientState,
} from '../../shared/game';
import type {
  BotDifficulty,
  ChatMessage,
  ClientGameState,
  EmoteMessage,
  GameCore,
  GameSettings,
  LobbyPlayer,
  Move,
  RoomInfo,
  Team,
} from '../../shared/types';
import { TEAMS } from '../../shared/types';

export interface NetHandlers {
  onRoomUpdate: (r: RoomInfo) => void;
  onGameState: (g: ClientGameState) => void;
  onChat: (m: ChatMessage) => void;
  onEmote: (m: EmoteMessage) => void;
  onError: (msg: string) => void;
  onKicked: () => void;
  onJoined: (code: string, spectator: boolean) => void;
  onClosed: (reason: string) => void;
}

const BOT_NAMES = [
  'Bot Ada',
  'Bot Turing',
  'Bot Hopper',
  'Bot Curie',
  'Bot Tesla',
  'Bot Lovelace',
  'Bot Newton',
  'Bot Darwin',
];

function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function rid(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return 'b-' + Math.random().toString(36).slice(2);
}
const peerIdFor = (code: string) => `seqrz-${code}`;

interface HostPlayer {
  id: string;
  name: string;
  avatar?: string;
  isBot: boolean;
  conn: DataConnection | null; // null for the host seat and bots
  connected: boolean;
}
interface Spectator {
  conn: DataConnection;
  name: string;
}

// ---------------- HOST ----------------

export class P2PHost {
  peer: Peer;
  code = '';
  hostId: string;
  players: HostPlayer[] = [];
  spectators: Spectator[] = [];
  settings: GameSettings;
  started = false;
  game: GameCore | null = null;
  botTimer: ReturnType<typeof setTimeout> | null = null;
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  undoSnapshot: string | null = null;
  undoRequest: { byId: string; byName: string } | null = null;
  private h: NetHandlers;
  private opened = false;

  constructor(hostId: string, hostName: string, avatar: string | undefined, h: NetHandlers) {
    this.hostId = hostId;
    this.h = h;
    this.settings = defaultSettings();
    this.players = [
      { id: hostId, name: hostName || 'Player', avatar, isBot: false, conn: null, connected: true },
    ];
    this.code = makeCode();
    this.peer = new Peer(peerIdFor(this.code), { debug: 0 });
    this.peer.on('open', () => {
      this.opened = true;
      this.h.onJoined(this.code, false);
      this.pushRoom();
    });
    // keep the room discoverable if the signaling socket blips
    this.peer.on('disconnected', () => {
      try {
        this.peer.reconnect();
      } catch {
        /* ignore */
      }
    });
    this.peer.on('connection', (conn) => this.onConn(conn));
    this.peer.on('error', (err: { type?: string }) => {
      if (!this.opened && err?.type === 'unavailable-id') {
        // extremely unlikely code collision — pick a new one and retry
        this.code = makeCode();
        try {
          this.peer.destroy();
        } catch {
          /* ignore */
        }
        this.peer = new Peer(peerIdFor(this.code), { debug: 0 });
        this.peer.on('open', () => {
          this.opened = true;
          this.h.onJoined(this.code, false);
          this.pushRoom();
        });
        this.peer.on('connection', (c) => this.onConn(c));
        return;
      }
      if (!this.opened) this.h.onError('Could not open a room. Please try again.');
    });
  }

  private onConn(conn: DataConnection) {
    conn.on('data', (raw) => this.onData(conn, raw as Record<string, unknown>));
    conn.on('close', () => this.onDisconnect(conn));
    conn.on('error', () => this.onDisconnect(conn));
  }

  private clean(v: unknown, max = 20): string {
    return typeof v === 'string' ? v.slice(0, max).trim() : '';
  }

  private onData(conn: DataConnection, msg: Record<string, unknown>) {
    const t = msg?.t;
    if (t === 'hello') {
      const playerId = this.clean(msg.playerId, 64) || rid();
      const name = this.clean(msg.name, 20) || 'Player';
      const avatar = this.clean(msg.avatar, 8) || undefined;
      const wantSpectate = msg.spectate === true;
      const existing = this.players.find((p) => p.id === playerId);
      if (existing) {
        existing.conn = conn;
        existing.connected = true;
        existing.isBot = false;
        if (this.game) {
          const gp = this.game.players.find((p) => p.id === playerId);
          if (gp) gp.isBot = false;
        }
        (conn as unknown as { _pid?: string })._pid = playerId;
        conn.send({ t: 'joined', code: this.code, spectator: false });
        this.pushRoom();
        this.pushState();
        if (this.game) this.scheduleBots();
        return;
      }
      if (wantSpectate || (this.started && true)) {
        // spectate if asked, or if the game already started (can't take a seat)
        this.spectators.push({ conn, name });
        (conn as unknown as { _spec?: boolean })._spec = true;
        conn.send({ t: 'joined', code: this.code, spectator: true });
        this.pushRoom();
        if (this.game) {
          const st = toClientState(this.game, '__spectator__');
          st.spectator = true;
          st.spectatorCount = this.spectators.length;
          conn.send({ t: 'state', s: st });
        }
        return;
      }
      if (this.players.length >= 12) {
        conn.send({ t: 'err', m: 'Room is full.' });
        return;
      }
      this.players.push({ id: playerId, name, avatar, isBot: false, conn, connected: true });
      (conn as unknown as { _pid?: string })._pid = playerId;
      conn.send({ t: 'joined', code: this.code, spectator: false });
      this.pushRoom();
      return;
    }

    const pid = (conn as unknown as { _pid?: string })._pid;
    if (!pid) return; // spectators / unjoined can't act
    if (t === 'move') this.applyPlayerMove(pid, msg.move as Move);
    else if (t === 'chat') this.chat(pid, this.clean(msg.text, 300));
    else if (t === 'emote') this.emote(pid, this.clean(msg.emote, 8));
    else if (t === 'undoReq') this.requestUndo(pid);
    else if (t === 'undoResp') this.respondUndo(pid, msg.approve === true);
  }

  private onDisconnect(conn: DataConnection) {
    const spec = this.spectators.find((s) => s.conn === conn);
    if (spec) {
      this.spectators = this.spectators.filter((s) => s.conn !== conn);
      this.pushRoom();
      this.pushState();
      return;
    }
    const pid = (conn as unknown as { _pid?: string })._pid;
    const p = this.players.find((x) => x.id === pid);
    if (!p) return;
    if (!this.started) {
      this.players = this.players.filter((x) => x.id !== pid);
      this.pushRoom();
    } else {
      // AI takes over the seat so the game continues
      p.connected = false;
      p.conn = null;
      p.isBot = true;
      const gp = this.game?.players.find((x) => x.id === pid);
      if (gp) gp.isBot = true;
      this.pushRoom();
      this.pushState();
      this.scheduleBots();
    }
  }

  // ---- lobby ----
  private validTeamCount(): 2 | 3 {
    const opts = teamOptionsFor(this.players.length);
    return (opts.includes(this.settings.teamCount) ? this.settings.teamCount : opts[0] ?? 2) as
      | 2
      | 3;
  }

  roomInfo(): RoomInfo {
    const teamOpts = teamOptionsFor(this.players.length);
    const teamCount = this.validTeamCount();
    const players: LobbyPlayer[] = this.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      team: teamOpts.length > 0 ? TEAMS[i % teamCount] : null,
      avatar: p.avatar,
    }));
    return {
      code: this.code,
      hostId: this.hostId,
      players,
      settings: { ...this.settings, teamCount },
      started: this.started,
      validCounts: Object.keys(HAND_SIZES).map(Number),
      spectatorCount: this.spectators.length,
    };
  }

  private pushRoom() {
    const info = this.roomInfo();
    this.h.onRoomUpdate(info);
    for (const p of this.players) if (p.conn) p.conn.send({ t: 'room', info });
    for (const s of this.spectators) s.conn.send({ t: 'room', info });
  }

  private pushState() {
    if (!this.game) return;
    // host's own view
    const mine = toClientState(this.game, this.hostId);
    mine.spectatorCount = this.spectators.length;
    mine.undoRequest = this.undoRequest && this.undoRequest.byId !== this.hostId ? this.undoRequest : null;
    this.h.onGameState(mine);
    for (const p of this.players) {
      if (!p.conn) continue;
      const st = toClientState(this.game, p.id);
      st.spectatorCount = this.spectators.length;
      st.undoRequest = this.undoRequest && this.undoRequest.byId !== p.id ? this.undoRequest : null;
      p.conn.send({ t: 'state', s: st });
    }
    for (const s of this.spectators) {
      const st = toClientState(this.game, '__spectator__');
      st.spectator = true;
      st.spectatorCount = this.spectators.length;
      s.conn.send({ t: 'state', s: st });
    }
  }

  // ---- host controls (called by the store from the host's UI) ----
  addBot() {
    if (this.started || this.players.length >= 12) return;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.length + 1}`;
    this.players.push({ id: rid(), name, isBot: true, conn: null, connected: true });
    this.pushRoom();
  }
  removePlayer(id: string) {
    if (this.started || id === this.hostId) return;
    const p = this.players.find((x) => x.id === id);
    if (p?.conn) p.conn.send({ t: 'kicked' });
    this.players = this.players.filter((x) => x.id !== id);
    this.pushRoom();
  }
  updateSettings(s: {
    teamCount?: number;
    strictDraw?: boolean;
    botDifficulty?: string;
    turnSeconds?: number;
  }) {
    if (this.started) return;
    if (s.teamCount === 2 || s.teamCount === 3) this.settings.teamCount = s.teamCount;
    if (typeof s.strictDraw === 'boolean') this.settings.strictDraw = s.strictDraw;
    if (s.botDifficulty === 'easy' || s.botDifficulty === 'medium' || s.botDifficulty === 'hard')
      this.settings.botDifficulty = s.botDifficulty;
    if (typeof s.turnSeconds === 'number') this.settings.turnSeconds = s.turnSeconds;
    this.pushRoom();
  }
  start(): string | null {
    const opts = teamOptionsFor(this.players.length);
    if (opts.length === 0)
      return `Need ${Object.keys(HAND_SIZES).join(' / ')} players (add bots or friends).`;
    const teamCount = this.validTeamCount();
    this.settings.teamCount = teamCount;
    const seated = this.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      team: TEAMS[i % teamCount],
    }));
    this.game = createGame(seated, { ...this.settings });
    for (const gp of this.game.players)
      gp.avatar = this.players.find((rp) => rp.id === gp.id)?.avatar;
    this.started = true;
    this.undoSnapshot = null;
    this.undoRequest = null;
    this.pushRoom();
    this.afterChange();
    return null;
  }
  rematch(): string | null {
    if (!this.game || (!this.game.winner && !this.game.stalemate)) return 'The game is not over yet.';
    this.players.push(this.players.shift()!); // rotate starter
    this.started = false;
    this.game = null;
    this.clearTimers();
    return this.start();
  }

  localMove(move: Move) {
    this.applyPlayerMove(this.hostId, move);
  }
  chatLocal(text: string) {
    this.chat(this.hostId, text);
  }
  emoteLocal(e: string) {
    this.emote(this.hostId, e);
  }
  requestUndoLocal() {
    this.requestUndo(this.hostId);
  }
  respondUndoLocal(a: boolean) {
    this.respondUndo(this.hostId, a);
  }

  // ---- engine ----
  private applyPlayerMove(pid: string, move: Move) {
    if (!this.game) return;
    const before = JSON.stringify(this.snapshot());
    const res = applyMove(this.game, pid, move);
    if (!res.ok) {
      const target = this.players.find((p) => p.id === pid);
      if (pid === this.hostId) this.h.onError(res.error ?? 'Illegal move.');
      else target?.conn?.send({ t: 'err', m: res.error ?? 'Illegal move.' });
      return;
    }
    this.undoSnapshot = before;
    this.undoRequest = null;
    this.afterChange();
  }

  private snapshot(): unknown {
    if (!this.game) return null;
    const { rng, ...rest } = this.game;
    void rng;
    return rest;
  }
  private restore(): boolean {
    if (!this.undoSnapshot || !this.game) return false;
    try {
      const parsed = JSON.parse(this.undoSnapshot) as GameCore;
      parsed.rng = this.game.rng ?? Math.random;
      this.game = parsed;
      this.undoSnapshot = null;
      this.undoRequest = null;
      return true;
    } catch {
      return false;
    }
  }

  private requestUndo(pid: string) {
    if (!this.game || !this.undoSnapshot) return;
    const last = this.game.log[this.game.log.length - 1];
    if (!last || last.playerId !== pid) return;
    const humanOpponents = this.players.filter((p) => !p.isBot && p.connected && p.id !== pid);
    const me = this.players.find((p) => p.id === pid);
    if (humanOpponents.length === 0) {
      if (this.restore()) this.afterChange();
      return;
    }
    this.undoRequest = { byId: pid, byName: me?.name ?? 'A player' };
    this.pushState();
  }
  private respondUndo(pid: string, approve: boolean) {
    if (!this.undoRequest || this.undoRequest.byId === pid) return;
    if (approve) {
      if (this.restore()) this.afterChange();
    } else {
      this.undoRequest = null;
      this.pushState();
    }
  }

  private chat(pid: string, text: string) {
    if (!text) return;
    const p = this.players.find((x) => x.id === pid);
    if (!p) return;
    const gp = this.game?.players.find((x) => x.id === pid);
    const msg: ChatMessage = { playerId: pid, name: p.name, team: gp?.team ?? null, text, ts: 0 };
    this.h.onChat(msg);
    for (const x of this.players) if (x.conn) x.conn.send({ t: 'chat', m: msg });
    for (const s of this.spectators) s.conn.send({ t: 'chat', m: msg });
  }
  private emote(pid: string, emote: string) {
    if (!emote) return;
    const p = this.players.find((x) => x.id === pid);
    if (!p) return;
    const gp = this.game?.players.find((x) => x.id === pid);
    const msg: EmoteMessage = { playerId: pid, name: p.name, team: gp?.team ?? null, emote, ts: 0 };
    this.h.onEmote(msg);
    for (const x of this.players) if (x.conn) x.conn.send({ t: 'emote', m: msg });
    for (const s of this.spectators) s.conn.send({ t: 'emote', m: msg });
  }

  private clearTimers() {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }
  private afterChange() {
    this.pushState();
    this.armTurnTimer();
    this.scheduleBots();
  }

  private scheduleBots() {
    const g = this.game;
    if (!g || g.winner || g.stalemate || this.botTimer) return;
    const cur = g.players[g.turn];
    const rp = this.players.find((p) => p.id === cur.id);
    const actsAsBot = cur.isBot || (rp && !rp.connected);
    if (!actsAsBot) return;
    this.botTimer = setTimeout(
      () => {
        this.botTimer = null;
        const gg = this.game;
        if (!gg || gg.winner || gg.stalemate) return;
        const p = gg.players[gg.turn];
        const r = this.players.find((x) => x.id === p.id);
        if (!(p.isBot || (r && !r.connected))) return;
        const mv = chooseBotMove(gg, p);
        if (!applyMove(gg, p.id, mv).ok) {
          const dead = p.hand.find((c) => isDeadCard(gg, c));
          if (!(dead && applyMove(gg, p.id, { type: 'exchangeDead', card: dead }).ok))
            applyMove(gg, p.id, forceLegalMove(gg, p));
        }
        if (gg.settings.strictDraw && (gg.pendingDraws[p.id] ?? 0) > 0)
          applyMove(gg, p.id, { type: 'draw' });
        this.undoSnapshot = null;
        this.undoRequest = null;
        this.pushState();
        this.armTurnTimer();
        this.scheduleBots();
      },
      750 + Math.random() * 800,
    );
  }

  private armTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    const g = this.game;
    if (!g || g.winner || g.stalemate) return;
    const secs = g.settings.turnSeconds ?? 0;
    if (secs <= 0) return;
    const cur = g.players[g.turn];
    const rp = this.players.find((p) => p.id === cur.id);
    if (!rp || cur.isBot || !rp.connected) return;
    const deadline = (g.turnStartedAt ?? Date.now()) + secs * 1000;
    this.turnTimer = setTimeout(
      () => {
        this.turnTimer = null;
        const gg = this.game;
        if (!gg || gg.winner || gg.stalemate) return;
        const p = gg.players[gg.turn];
        if (!p || p.id !== cur.id) return;
        applyMove(gg, p.id, forceLegalMove(gg, p));
        if (gg.settings.strictDraw && (gg.pendingDraws[p.id] ?? 0) > 0)
          applyMove(gg, p.id, { type: 'draw' });
        this.undoSnapshot = null;
        this.undoRequest = null;
        this.afterChange();
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  destroy() {
    this.clearTimers();
    for (const p of this.players) p.conn?.send({ t: 'closed', reason: 'The host left.' });
    for (const s of this.spectators) s.conn.send({ t: 'closed', reason: 'The host left.' });
    setTimeout(() => {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
    }, 120);
  }
}

// ---------------- GUEST ----------------

export class P2PGuest {
  peer: Peer;
  conn: DataConnection | null = null;
  private h: NetHandlers;
  private playerId: string;
  private name: string;
  private avatar?: string;
  private spectate: boolean;
  private settled = false;

  constructor(
    code: string,
    playerId: string,
    name: string,
    avatar: string | undefined,
    spectate: boolean,
    h: NetHandlers,
  ) {
    this.h = h;
    this.playerId = playerId;
    this.name = name;
    this.avatar = avatar;
    this.spectate = spectate;
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer.connect(peerIdFor(code.toUpperCase()), { reliable: true });
      this.conn = conn;
      conn.on('open', () => {
        conn.send({
          t: 'hello',
          playerId: this.playerId,
          name: this.name,
          avatar: this.avatar,
          spectate: this.spectate,
        });
      });
      conn.on('data', (raw) => this.onData(raw as Record<string, unknown>));
      conn.on('close', () => {
        if (this.settled) this.h.onClosed('Disconnected from the host.');
        else this.h.onError('Room not found. Check the code.');
      });
      conn.on('error', () => {
        if (!this.settled) this.h.onError('Could not connect to that room.');
      });
    });
    this.peer.on('error', (err: { type?: string }) => {
      if (this.settled) return;
      if (err?.type === 'peer-unavailable') this.h.onError('Room not found. Check the code.');
      else this.h.onError('Could not connect. Try again.');
    });
    // give up if nothing happens
    setTimeout(() => {
      if (!this.settled) this.h.onError('Room not found. Check the code.');
    }, 12000);
  }

  private onData(msg: Record<string, unknown>) {
    const t = msg?.t;
    if (t === 'joined') {
      this.settled = true;
      this.h.onJoined(String(msg.code ?? ''), msg.spectator === true);
    } else if (t === 'room') this.h.onRoomUpdate(msg.info as RoomInfo);
    else if (t === 'state') this.h.onGameState(msg.s as ClientGameState);
    else if (t === 'chat') this.h.onChat(msg.m as ChatMessage);
    else if (t === 'emote') this.h.onEmote(msg.m as EmoteMessage);
    else if (t === 'err') this.h.onError(String(msg.m ?? 'Error'));
    else if (t === 'kicked') this.h.onKicked();
    else if (t === 'closed') this.h.onClosed(String(msg.reason ?? 'The room closed.'));
  }

  send(msg: Record<string, unknown>) {
    try {
      this.conn?.send(msg);
    } catch {
      /* ignore */
    }
  }
  destroy() {
    try {
      this.conn?.close();
      this.peer.destroy();
    } catch {
      /* ignore */
    }
  }
}
