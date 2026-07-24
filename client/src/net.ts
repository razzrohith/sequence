// Online multiplayer transport over a public MQTT broker (WebSocket).
//
// Both the host and the guests connect to the same always-on public broker and
// exchange messages on topics namespaced by the room code. Unlike WebRTC there
// is no peer-to-peer discovery or NAT traversal, so it works reliably across
// different networks (laptop on Wi-Fi + phone on cellular, etc.).
//
// The room creator is the HOST: their browser runs the authoritative game engine
// (the same shared code the dedicated server uses) and relays state to guests.
import mqtt, { type MqttClient } from 'mqtt';
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
  turnDeadlineFor,
} from '../../shared/game';
import type {
  ChatMessage,
  ClientGameState,
  EmoteMessage,
  GameCore,
  GameSettings,
  LobbyPlayer,
  Move,
  RoomInfo,
} from '../../shared/types';
import { TEAMS } from '../../shared/types';

/** Full authoritative state the host replicates to its heir, so the heir can
 * take over hosting if the host leaves (host migration). */
export interface HostSnapshot {
  hostId: string; // the (old) host's player id
  settings: GameSettings;
  players: {
    id: string;
    name: string;
    avatar?: string;
    isBot: boolean;
    connected: boolean;
    ready?: boolean;
  }[];
  started: boolean;
  core: GameCore | null; // rng stripped
}

export interface NetHandlers {
  onRoomUpdate: (r: RoomInfo) => void;
  onGameState: (g: ClientGameState) => void;
  onChat: (m: ChatMessage) => void;
  onEmote: (m: EmoteMessage) => void;
  onError: (msg: string) => void;
  onKicked: () => void;
  onJoined: (code: string, spectator: boolean) => void;
  onClosed: (reason: string) => void;
  /** a table-wide notice, e.g. that someone took a hint */
  onNotice: (text: string) => void;
  /** the host left and this client is the heir, become the new host */
  onBecomeHost: (code: string, snap: HostSnapshot) => void;
}

// Public MQTT-over-WebSocket brokers (tried in order). No account required.
// Public MQTT-over-WebSocket brokers (no account needed). The room code's first
// letter records which broker the host is on, so guests connect to the same one
//, this gives transparent failover if a broker is unreachable.
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const BROKER_PREFIX = ['E', 'H']; // one letter per broker, part of the room code
const TOPIC = 'seqrz2';
const QOS = 1 as const;
/** How long the heir waits after a host's Last-Will before taking over. The will
 * also fires on a transient drop, and the host auto-reconnects (reconnectPeriod
 * 2000ms) and re-announces, this grace stops a blip creating two hosts. */
const HOST_GONE_GRACE_MS = 5000;

function mqttOptions(pid: string, will: { topic: string; payload: string }) {
  return {
    clientId: `seqrz-${pid.slice(0, 24)}-${Math.random().toString(36).slice(2, 8)}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000, // auto-reconnect on a dropped connection
    connectTimeout: 9000,
    resubscribe: true, // restore subscriptions after a reconnect
    will: { topic: will.topic, payload: will.payload, qos: QOS, retain: false },
  };
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
function makeCode4(): string {
  // No O/0 or I/1, and none of the digits people misread as letters when copying
  // a code off a screen: 8 as B, 5 as S, 6 as G, 2 as Z.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ3479';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function rid(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return 'b-' + Math.random().toString(36).slice(2);
}

interface HostPlayer {
  id: string;
  name: string;
  avatar?: string;
  isBot: boolean;
  connected: boolean;
  ready?: boolean;
}

// ---------------- HOST ----------------

export class NetHost {
  client: MqttClient;
  code: string;
  hostId: string;
  players: HostPlayer[] = [];
  spectators: { id: string; name: string }[] = [];
  settings: GameSettings;
  started = false;
  game: GameCore | null = null;
  botTimer: ReturnType<typeof setTimeout> | null = null;
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  undoSnapshot: string | null = null;
  undoRequest: { byId: string; byName: string } | null = null;
  private h: NetHandlers;
  private base = '';
  private opened = false;
  private brokerIdx = 0;

  private seeded = false;
  private seededFailed = false;

  constructor(
    hostId: string,
    hostName: string,
    avatar: string | undefined,
    h: NetHandlers,
    seed?: { code: string; snap: HostSnapshot },
  ) {
    this.hostId = hostId;
    this.h = h;
    this.client = undefined as unknown as MqttClient;
    if (seed) {
      // taking over an existing room (host migration): keep the code + state
      this.seeded = true;
      this.code = seed.code;
      this.settings = seed.snap.settings;
      this.players = seed.snap.players.map((p) => ({ ...p }));
      const old = this.players.find((p) => p.id === seed.snap.hostId);
      if (old && old.id !== hostId) {
        old.connected = false;
        old.isBot = true; // AI plays the departed host's seat
      }
      let me = this.players.find((p) => p.id === hostId);
      if (!me) {
        me = { id: hostId, name: hostName || 'Player', avatar, isBot: false, connected: true };
        this.players.push(me);
      }
      me.connected = true;
      me.isBot = false;
      this.started = seed.snap.started;
      this.game = seed.snap.core ? { ...seed.snap.core, rng: Math.random } : null;
      if (this.game) {
        for (const gp of this.game.players) {
          const rp = this.players.find((p) => p.id === gp.id);
          if (rp) gp.isBot = rp.isBot;
        }
      }
      this.brokerIdx = Math.max(0, BROKER_PREFIX.indexOf(this.code[0] ?? ''));
    } else {
      this.settings = defaultSettings();
      this.players = [
        { id: hostId, name: hostName || 'Player', avatar, isBot: false, connected: true },
      ];
      this.code = '';
    }
    this.connectBroker();
  }

  /** Try the current broker; if it can't be reached, fall over to the next. */
  private connectBroker() {
    const idx = this.brokerIdx;
    if (!this.seeded) this.code = BROKER_PREFIX[idx] + makeCode4();
    this.base = `${TOPIC}/${this.code}`;
    let settled = false;
    this.client = mqtt.connect(
      BROKERS[idx],
      mqttOptions(this.hostId, {
        topic: `${this.base}/b`,
        payload: JSON.stringify({ t: 'hostgone' }),
      }),
    );
    const failover = () => {
      if (settled) return;
      settled = true;
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
      this.brokerIdx += 1;
      if (this.brokerIdx >= BROKERS.length) {
        this.h.onError('Could not reach the game network. Please try again.');
        return;
      }
      this.connectBroker();
    };
    // a seeded (migrated) host must stay on the code's own broker, don't fail over
    const failTimer = this.seeded ? null : setTimeout(failover, 9500);
    this.client.on('connect', () => {
      settled = true;
      if (failTimer) clearTimeout(failTimer);
      this.client.subscribe(`${this.base}/h`, { qos: QOS }, () => {
        if (!this.opened) {
          this.opened = true;
          this.h.onJoined(this.code, false);
          this.pushRoom();
          if (this.seeded && this.game) this.afterChange(); // resume the migrated game
        } else {
          // reconnected mid-game: resend current room + state
          this.pushRoom();
          this.pushState();
        }
      });
    });
    this.client.on('message', (topic, payload) => {
      if (topic !== `${this.base}/h`) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(payload.toString());
      } catch {
        return;
      }
      this.onData(msg);
    });
    this.client.on('error', () => {
      if (this.opened) return;
      // A migrated (seeded) host is pinned to the broker encoded in its room
      // code's first letter, guests resolve the broker from that letter alone.
      // Switching brokers here would keep the code but move the host, silently
      // orphaning every guest, so surface the failure instead of failing over.
      if (this.seeded) {
        if (!this.seededFailed) {
          this.seededFailed = true;
          this.h.onError('Lost the game network. Please start a new room.');
        }
        return;
      }
      failover();
    });
  }

  private pub(sub: string, msg: unknown) {
    try {
      this.client.publish(`${this.base}/${sub}`, JSON.stringify(msg), { qos: QOS });
    } catch {
      /* ignore */
    }
  }
  private toPlayer(id: string, msg: unknown) {
    this.pub(`p/${id}`, msg);
  }

  private clean(v: unknown, max = 20): string {
    return typeof v === 'string' ? v.slice(0, max).trim() : '';
  }

  private onData(msg: Record<string, unknown>) {
    const from = this.clean(msg.from, 64);
    const t = msg.t;
    if (t === 'hello') {
      const playerId = from || rid();
      const name = this.clean(msg.name, 20) || 'Player';
      const avatar = this.clean(msg.avatar, 8) || undefined;
      const wantSpectate = msg.spectate === true;
      const existing = this.players.find((p) => p.id === playerId);
      // optional room password: only gates new arrivals, not reconnects
      const pw = this.settings.password ?? '';
      if (pw && !existing && this.clean(msg.pw, 24) !== pw) {
        this.toPlayer(playerId, { t: 'err', m: 'Wrong room password.' });
        return;
      }
      if (existing) {
        existing.connected = true;
        existing.isBot = false;
        if (this.game) {
          const gp = this.game.players.find((p) => p.id === playerId);
          if (gp) gp.isBot = false;
        }
        this.toPlayer(playerId, { t: 'joined', code: this.code, spectator: false });
        this.pushRoom();
        this.pushState();
        if (this.game) this.scheduleBots();
        return;
      }
      if (wantSpectate || this.started) {
        if (!this.spectators.some((s) => s.id === playerId))
          this.spectators.push({ id: playerId, name });
        this.toPlayer(playerId, { t: 'joined', code: this.code, spectator: true });
        this.pushRoom();
        if (this.game) {
          const st = toClientState(this.game, '__spectator__');
          st.spectator = true;
          st.spectatorCount = this.spectators.length;
          this.toPlayer(playerId, { t: 'state', s: st });
        }
        return;
      }
      if (this.players.length >= 12) {
        this.toPlayer(playerId, { t: 'err', m: 'Room is full.' });
        return;
      }
      this.players.push({ id: playerId, name, avatar, isBot: false, connected: true });
      this.toPlayer(playerId, { t: 'joined', code: this.code, spectator: false });
      this.pushRoom();
      return;
    }

    if (!from) return;
    if (t === 'bye') this.onLeave(from);
    else if (t === 'move') this.applyPlayerMove(from, msg.move as Move);
    else if (t === 'chat') this.chat(from, this.clean(msg.text, 300));
    else if (t === 'emote') this.emote(from, this.clean(msg.emote, 8));
    else if (t === 'ready') this.setReady(from, msg.ready === true);
    else if (t === 'hint') this.announceHint(from);
    else if (t === 'undoReq') this.requestUndo(from);
    else if (t === 'undoResp') this.respondUndo(from, msg.approve === true);
  }

  private onLeave(pid: string) {
    if (this.spectators.some((s) => s.id === pid)) {
      this.spectators = this.spectators.filter((s) => s.id !== pid);
      this.pushRoom();
      this.pushState();
      return;
    }
    const p = this.players.find((x) => x.id === pid);
    if (!p) return;
    if (!this.started) {
      this.players = this.players.filter((x) => x.id !== pid);
      this.pushRoom();
    } else {
      p.connected = false;
      p.isBot = true;
      const gp = this.game?.players.find((x) => x.id === pid);
      if (gp) gp.isBot = true;
      this.pushRoom();
      this.pushState();
      this.scheduleBots();
    }
  }

  private validTeamCount(): 2 | 3 {
    const opts = teamOptionsFor(this.players.length);
    return (opts.includes(this.settings.teamCount) ? this.settings.teamCount : (opts[0] ?? 2)) as
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
      ready: p.isBot ? true : !!p.ready,
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

  /** The connected human player (not the host) with the lowest seat, becomes
   * host if the current host leaves. */
  private heirId(): string | null {
    const heir = this.players.find((p) => !p.isBot && p.connected && p.id !== this.hostId);
    return heir ? heir.id : null;
  }
  /** Replicate full authoritative state to the heir so they can take over. */
  private sendSnapshotToHeir() {
    const heir = this.heirId();
    if (!heir) return;
    const { rng, ...core } = this.game ?? ({} as GameCore);
    void rng;
    const snap: HostSnapshot = {
      hostId: this.hostId,
      settings: this.settings,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        connected: p.connected,
        ready: p.ready,
      })),
      started: this.started,
      core: this.game ? (core as GameCore) : null,
    };
    this.toPlayer(heir, { t: 'full', snap });
  }

  /** let the store nudge a room refresh (used when the host toggles ready) */
  pushRoomPublic() {
    this.pushRoom();
  }

  private pushRoom() {
    // the host keeps the full settings (its own lobby shows the password), but the
    // published copy is redacted: the broadcast topic is readable by anyone
    const info = this.roomInfo();
    this.h.onRoomUpdate(info);
    const shared = { ...info, settings: { ...info.settings, password: undefined } };
    this.pub('b', { t: 'room', info: shared });
    this.sendSnapshotToHeir();
  }

  private pushState() {
    if (!this.game) return;
    const mine = toClientState(this.game, this.hostId);
    mine.spectatorCount = this.spectators.length;
    mine.undoRequest =
      this.undoRequest && this.undoRequest.byId !== this.hostId ? this.undoRequest : null;
    this.h.onGameState(mine);
    for (const p of this.players) {
      if (p.id === this.hostId) continue;
      const st = toClientState(this.game, p.id);
      st.spectatorCount = this.spectators.length;
      st.undoRequest = this.undoRequest && this.undoRequest.byId !== p.id ? this.undoRequest : null;
      this.toPlayer(p.id, { t: 'state', s: st });
    }
    for (const s of this.spectators) {
      const st = toClientState(this.game, '__spectator__');
      st.spectator = true;
      st.spectatorCount = this.spectators.length;
      this.toPlayer(s.id, { t: 'state', s: st });
    }
    this.sendSnapshotToHeir();
  }

  // ---- host controls ----
  addBot() {
    if (this.started || this.players.length >= 12) return;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.length + 1}`;
    this.players.push({ id: rid(), name, isBot: true, connected: true });
    this.pushRoom();
  }
  removePlayer(id: string) {
    if (this.started || id === this.hostId) return;
    this.toPlayer(id, { t: 'kicked' });
    this.players = this.players.filter((x) => x.id !== id);
    this.pushRoom();
  }
  updateSettings(s: {
    teamCount?: number;
    strictDraw?: boolean;
    botDifficulty?: string;
    turnSeconds?: number;
    winSequences?: number;
    boardTheme?: string;
    randomBoard?: boolean;
    undoMode?: string;
    hints?: boolean;
    firstPlayer?: string;
    allowDeadExchange?: boolean;
    clockSeconds?: number;
    handicapTeam?: string;
    handicapExtra?: number;
    password?: string;
    teamChat?: boolean;
  }) {
    // the board theme is purely cosmetic, so the host may change it mid-game
    const themed = typeof s.boardTheme === 'string' && /^[a-z]{2,12}$/.test(s.boardTheme);
    if (themed) this.settings.boardTheme = s.boardTheme;
    if (this.started) {
      if (themed) this.pushRoom();
      return;
    }
    if (s.teamCount === 2 || s.teamCount === 3) this.settings.teamCount = s.teamCount;
    if (typeof s.strictDraw === 'boolean') this.settings.strictDraw = s.strictDraw;
    if (s.botDifficulty === 'easy' || s.botDifficulty === 'medium' || s.botDifficulty === 'hard')
      this.settings.botDifficulty = s.botDifficulty;
    if (typeof s.turnSeconds === 'number') this.settings.turnSeconds = s.turnSeconds;
    if (s.winSequences === 1 || s.winSequences === 2) this.settings.winSequences = s.winSequences;
    if (typeof s.randomBoard === 'boolean') this.settings.randomBoard = s.randomBoard;
    if (s.undoMode === 'off' || s.undoMode === 'instant' || s.undoMode === 'approval')
      this.settings.undoMode = s.undoMode;
    if (typeof s.hints === 'boolean') this.settings.hints = s.hints;
    if (s.firstPlayer === 'first' || s.firstPlayer === 'random')
      this.settings.firstPlayer = s.firstPlayer;
    if (typeof s.allowDeadExchange === 'boolean')
      this.settings.allowDeadExchange = s.allowDeadExchange;
    if (typeof s.clockSeconds === 'number' && s.clockSeconds >= 0 && s.clockSeconds <= 7200)
      this.settings.clockSeconds = Math.floor(s.clockSeconds);
    if (s.handicapTeam === 'red' || s.handicapTeam === 'blue' || s.handicapTeam === 'green')
      this.settings.handicapTeam = s.handicapTeam;
    if (s.handicapTeam === '') this.settings.handicapTeam = undefined;
    if (typeof s.handicapExtra === 'number' && s.handicapExtra >= 0 && s.handicapExtra <= 3)
      this.settings.handicapExtra = Math.floor(s.handicapExtra);
    if (typeof s.password === 'string') this.settings.password = s.password.slice(0, 24).trim();
    if (typeof s.teamChat === 'boolean') this.settings.teamChat = s.teamChat;
    this.pushRoom();
  }
  start(): string | null {
    const opts = teamOptionsFor(this.players.length);
    if (opts.length === 0)
      return `Need ${Object.keys(HAND_SIZES).join(' / ')} players (add bots or friends).`;
    // everyone has to say they are ready, so nobody is dealt in mid-setup
    const notReady = this.players.filter(
      (p) => !p.isBot && p.connected && p.id !== this.hostId && !p.ready,
    );
    if (notReady.length > 0)
      return `Waiting for ${notReady.map((p) => p.name).join(', ')} to be ready.`;
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
    if (!this.game || (!this.game.winner && !this.game.stalemate))
      return 'The game is not over yet.';
    // start() can refuse (someone not ready, wrong player count). Check that up
    // front: tearing the game down first would leave the room with no game and
    // no route back, since a failed start() emits no room or state update.
    const notReady = this.players.filter(
      (p) => !p.isBot && p.connected && p.id !== this.hostId && !p.ready,
    );
    if (notReady.length > 0)
      return `Waiting for ${notReady.map((p) => p.name).join(', ')} to be ready.`;
    if (teamOptionsFor(this.players.length).length === 0)
      return `Need ${Object.keys(HAND_SIZES).join(' / ')} players (add bots or friends).`;
    this.players.push(this.players.shift()!);
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
      if (pid === this.hostId) this.h.onError(res.error ?? 'Illegal move.');
      else this.toPlayer(pid, { t: 'err', m: res.error ?? 'Illegal move.' });
      return;
    }
    this.undoSnapshot = before;
    this.undoRequest = null;
    this.afterChange();
  }
  private snapshot(): unknown {
    if (!this.game) return null;
    // turnStartedAt is wall-clock, not game state: restoring it would bill the
    // undo request and the opponent's deliberation to the player who undid
    const { rng, turnStartedAt, ...rest } = this.game;
    void rng;
    void turnStartedAt;
    return rest;
  }
  private restore(): boolean {
    if (!this.undoSnapshot || !this.game) return false;
    try {
      const parsed = JSON.parse(this.undoSnapshot) as GameCore;
      parsed.rng = this.game.rng ?? Math.random;
      parsed.turnStartedAt = Date.now(); // the restored turn starts now
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
    const mode = this.settings.undoMode ?? 'approval';
    if (mode === 'off') {
      const msg = 'Undo is turned off for this game.';
      if (pid === this.hostId) this.h.onError(msg);
      else this.toPlayer(pid, { t: 'err', m: msg });
      return;
    }
    // only the most recent move can be taken back: once the next player has
    // moved, the log's last entry is theirs and the snapshot has been replaced
    const last = this.game.log[this.game.log.length - 1];
    if (!last || last.playerId !== pid) {
      const msg = 'Too late, the next player has already moved.';
      if (pid === this.hostId) this.h.onError(msg);
      else this.toPlayer(pid, { t: 'err', m: msg });
      return;
    }
    const humanOpp = this.players.filter((p) => !p.isBot && p.connected && p.id !== pid);
    const me = this.players.find((p) => p.id === pid);
    // straight undo, or nobody around to ask
    if (mode === 'instant' || humanOpp.length === 0) {
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
    const p =
      this.players.find((x) => x.id === pid) ??
      this.spectators.find((x) => x.id === pid);
    if (!p) return;
    const gp = this.game?.players.find((x) => x.id === pid);
    const msg: ChatMessage = { playerId: pid, name: p.name, team: gp?.team ?? null, text, ts: 0 };
    if (this.settings.teamChat && this.game && gp?.team) {
      // team-only: send to that team's seats, never on the shared broadcast topic
      for (const other of this.game.players) {
        if (other.team !== gp.team) continue;
        if (other.id === this.hostId) this.h.onChat(msg);
        else this.toPlayer(other.id, { t: 'chat', m: msg });
      }
      return;
    }
    this.h.onChat(msg);
    this.pub('b', { t: 'chat', m: msg });
  }
  /** Hints are computed on each player's own device, so the table only learns
   * about one if we say so. Everyone is told, including the player who asked. */
  announceHint(pid: string) {
    if (this.settings.hints !== true) return;
    const p = this.players.find((x) => x.id === pid);
    if (!p) return;
    const text = `${p.name} took a hint`;
    this.h.onNotice(text);
    this.pub('b', { t: 'notice', m: text });
  }

  private setReady(pid: string, ready: boolean) {
    const p = this.players.find((x) => x.id === pid);
    if (!p || this.started) return;
    p.ready = ready;
    this.pushRoom();
  }

  /** at most one emote every 1.5s per player, so nobody can spam the table */
  private emoteAt = new Map<string, number>();
  private emote(pid: string, emote: string) {
    if (!emote) return;
    const now = Date.now();
    if (now - (this.emoteAt.get(pid) ?? 0) < 1500) return;
    this.emoteAt.set(pid, now);
    const p = this.players.find((x) => x.id === pid);
    if (!p) return;
    const gp = this.game?.players.find((x) => x.id === pid);
    const msg: EmoteMessage = { playerId: pid, name: p.name, team: gp?.team ?? null, emote, ts: 0 };
    this.h.onEmote(msg);
    this.pub('b', { t: 'emote', m: msg });
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
    if (!(cur.isBot || (rp && !rp.connected))) return;
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
    // whichever runs out first: the per-turn timer or this player's game clock
    const deadline = turnDeadlineFor(g);
    if (deadline === null) return;
    const cur = g.players[g.turn];
    const rp = this.players.find((p) => p.id === cur.id);
    if (!rp || cur.isBot || !rp.connected) return;
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
    // if a human can take over, hand the room off (heir promotes); otherwise close it
    const heir = this.heirId();
    this.sendSnapshotToHeir();
    this.pub('b', heir ? { t: 'hostgone' } : { t: 'closed', reason: 'The host left.' });
    setTimeout(() => {
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
    }, 250);
  }
}

// ---------------- GUEST ----------------

export class NetGuest {
  client: MqttClient;
  private h: NetHandlers;
  private playerId: string;
  private name: string;
  private avatar?: string;
  private spectate: boolean;
  private password: string;
  private base: string;
  private code: string;
  private settled = false;
  private lastRoom: RoomInfo | null = null;
  private lastFull: HostSnapshot | null = null;
  private migrating = false;
  /** bumped on every host broadcast, proof the host is still alive */
  private hostMsgSeq = 0;
  /** every pending timer, so destroy() can't leave one to fire into a later room */
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  private later(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }
  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  constructor(
    code: string,
    playerId: string,
    name: string,
    avatar: string | undefined,
    spectate: boolean,
    h: NetHandlers,
    password = '',
  ) {
    this.h = h;
    this.password = password;
    this.playerId = playerId;
    this.name = name;
    this.avatar = avatar;
    this.spectate = spectate;
    const full = code.trim().toUpperCase();
    this.code = full;
    this.base = `${TOPIC}/${full}`;
    // the code's first letter tells us which broker the host is on
    const idx = Math.max(0, BROKER_PREFIX.indexOf(full[0] ?? ''));
    this.client = mqtt.connect(
      BROKERS[idx] ?? BROKERS[0],
      mqttOptions(playerId, {
        topic: `${this.base}/h`,
        payload: JSON.stringify({ t: 'bye', from: playerId }),
      }),
    );
    this.client.on('connect', () => {
      this.client.subscribe([`${this.base}/b`, `${this.base}/p/${playerId}`], { qos: QOS }, () => {
        this.hello();
      });
    });
    this.client.on('message', (_topic, payload) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(payload.toString());
      } catch {
        return;
      }
      this.onData(msg);
    });
    this.client.on('error', () => {
      if (!this.settled) this.h.onError('Could not reach the game network. Try again.');
    });
    // resend hello a couple times in case the host was mid-subscribe, then give up
    this.later(() => !this.settled && this.hello(), 1500);
    this.later(() => !this.settled && this.hello(), 4000);
    this.later(() => {
      if (!this.settled) this.h.onError('Room not found. Check the code.');
    }, 11000);
  }

  private hello() {
    try {
      this.client.publish(
        `${this.base}/h`,
        JSON.stringify({
          t: 'hello',
          from: this.playerId,
          name: this.name,
          avatar: this.avatar,
          spectate: this.spectate,
          pw: this.password,
        }),
        { qos: QOS },
      );
    } catch {
      /* ignore */
    }
  }

  private onData(msg: Record<string, unknown>) {
    const t = msg.t;
    // any traffic other than the will itself proves the host is still alive
    if (t !== 'hostgone') this.hostMsgSeq++;
    if (t === 'joined') {
      this.settled = true;
      this.h.onJoined(String(msg.code ?? ''), msg.spectator === true);
    } else if (t === 'room') {
      this.lastRoom = msg.info as RoomInfo;
      this.h.onRoomUpdate(this.lastRoom);
    } else if (t === 'state') this.h.onGameState(msg.s as ClientGameState);
    else if (t === 'chat') this.h.onChat(msg.m as ChatMessage);
    else if (t === 'emote') this.h.onEmote(msg.m as EmoteMessage);
    else if (t === 'err') this.h.onError(String(msg.m ?? 'Error'));
    else if (t === 'kicked') this.h.onKicked();
    else if (t === 'full') this.lastFull = msg.snap as HostSnapshot; // I'm the heir
    else if (t === 'hostgone') this.handleHostGone();
    else if (t === 'closed') this.h.onClosed(String(msg.reason ?? 'The room closed.'));
    else if (t === 'notice') this.h.onNotice(String(msg.m ?? ''));
  }

  /** Host left: if I'm the designated heir (and hold a snapshot), take over as
   * the new host on the same room code; otherwise wait for the new host. */
  private handleHostGone() {
    if (this.migrating) return;
    this.migrating = true;
    const room = this.lastRoom;
    const heir = room?.players.find((p) => !p.isBot && p.connected && p.id !== room.hostId);
    if (heir && heir.id === this.playerId && this.lastFull) {
      // I'm the heir. The broker also publishes this will on a TRANSIENT host
      // drop (wifi blip, laptop sleep, clientId session takeover), the host
      // auto-reconnects and re-announces. Promoting immediately would leave two
      // authoritative engines on one room code, so wait and see if it speaks again.
      const seqAtGone = this.hostMsgSeq;
      this.later(() => {
        if (this.hostMsgSeq !== seqAtGone) {
          this.migrating = false; // the host came back, it never really left
          return;
        }
        try {
          this.client.end(true);
        } catch {
          /* ignore */
        }
        this.h.onBecomeHost(this.code, this.lastFull!);
      }, HOST_GONE_GRACE_MS);
      return;
    }
    // not the heir (or no snapshot): the heir should promote and re-broadcast.
    // If nothing arrives soon, the room is gone.
    const roomAtGone = this.lastRoom;
    // must outlast the heir's grace period plus its takeover, or we'd declare the
    // room dead while a new host is still coming up
    this.later(() => {
      if (this.lastRoom === roomAtGone) this.h.onClosed('The room closed.');
      else this.migrating = false; // a new host took over; carry on
    }, HOST_GONE_GRACE_MS + 9000);
  }

  /** tell the table this player just took a hint */
  hintUsed() {
    this.send({ t: 'hint' });
  }

  ready(v: boolean) {
    this.send({ t: 'ready', ready: v });
  }

  send(msg: Record<string, unknown>) {
    try {
      this.client.publish(`${this.base}/h`, JSON.stringify({ ...msg, from: this.playerId }), {
        qos: QOS,
      });
    } catch {
      /* ignore */
    }
  }
  destroy() {
    this.send({ t: 'bye' });
    // drop pending retries/timeouts first, otherwise a stale "Room not found"
    // or "The room closed" can fire later and evict the user from another room
    this.clearTimers();
    this.settled = true;
    setTimeout(() => {
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
    }, 150);
  }
}
