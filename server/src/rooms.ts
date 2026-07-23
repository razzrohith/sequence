import { randomUUID } from 'node:crypto';
import { chooseBotMove } from '../../shared/bot';
import {
  HAND_SIZES,
  applyMove,
  createGame,
  defaultSettings,
  forceLegalMove,
  teamOptionsFor,
  toClientState,
} from '../../shared/game';
import type {
  GameCore,
  GameSettings,
  LobbyPlayer,
  RoomInfo,
  Team,
} from '../../shared/types';
import { TEAMS } from '../../shared/types';

export interface RoomPlayer {
  id: string; // stable, client-persisted display id
  token: string | null; // private reconnect secret (never broadcast)
  name: string;
  isBot: boolean;
  connected: boolean;
  socketId: string | null;
  avatar?: string;
}

export interface Spectator {
  socketId: string;
  name: string;
}

export interface Room {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  spectators: Spectator[];
  settings: GameSettings;
  started: boolean;
  game: GameCore | null;
  botTimer: NodeJS.Timeout | null;
  turnTimer: NodeJS.Timeout | null;
  /** serialized pre-move state for a single-level undo, and who may undo it */
  undoSnapshot: string | null;
  undoRequest: { byId: string; byName: string } | null;
  createdAt: number;
  lastActivityAt: number;
}

const rooms = new Map<string, Room>();

export const MAX_ROOMS = 500;
export function roomCount(): number {
  return rooms.size;
}
export function touchRoom(room: Room) {
  room.lastActivityAt = Date.now();
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
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(
      '',
    );
  } while (rooms.has(code));
  return code;
}

export function createRoom(
  hostName: string,
  playerId: string,
  token: string,
  avatar?: string,
): Room {
  const now = Date.now();
  const room: Room = {
    code: makeCode(),
    hostId: playerId,
    players: [
      { id: playerId, token, name: hostName, isBot: false, connected: true, socketId: null, avatar },
    ],
    spectators: [],
    settings: defaultSettings(),
    started: false,
    game: null,
    botTimer: null,
    turnTimer: null,
    undoSnapshot: null,
    undoRequest: null,
    createdAt: now,
    lastActivityAt: now,
  };
  rooms.set(room.code, room);
  return room;
}

/** Serialize the game (minus its rng function) so a move can be undone. */
export function snapshotGame(room: Room) {
  if (!room.game) return;
  const { rng, ...rest } = room.game;
  void rng;
  room.undoSnapshot = JSON.stringify(rest);
}

/** Restore the last snapshot; returns true on success. */
export function restoreSnapshot(room: Room): boolean {
  if (!room.undoSnapshot || !room.game) return false;
  try {
    const parsed = JSON.parse(room.undoSnapshot) as GameCore;
    parsed.rng = room.game.rng ?? Math.random;
    room.game = parsed;
    room.undoSnapshot = null;
    room.undoRequest = null;
    return true;
  } catch {
    return false;
  }
}

/** Ensure hostId points to a connected human when possible. Returns true if changed. */
export function ensureHost(room: Room): boolean {
  const host = room.players.find((p) => p.id === room.hostId);
  if (host && !host.isBot && host.connected) return false;
  const next =
    room.players.find((p) => !p.isBot && p.connected) ?? room.players.find((p) => !p.isBot);
  if (next && next.id !== room.hostId) {
    room.hostId = next.id;
    return true;
  }
  return false;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function deleteRoom(code: string) {
  const room = rooms.get(code);
  if (room?.botTimer) clearTimeout(room.botTimer);
  if (room?.turnTimer) clearTimeout(room.turnTimer);
  rooms.delete(code);
}

export function addBot(room: Room): RoomPlayer | null {
  if (room.players.length >= 12 || room.started) return null;
  const used = new Set(room.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${room.players.length + 1}`;
  const bot: RoomPlayer = {
    id: randomUUID(),
    token: null,
    name,
    isBot: true,
    connected: true,
    socketId: null,
  };
  room.players.push(bot);
  return bot;
}

export function roomInfo(room: Room): RoomInfo {
  const n = room.players.length;
  const teamOpts = teamOptionsFor(n);
  // pre-game team preview based on seating order
  const teamCount = teamOpts.includes(room.settings.teamCount)
    ? room.settings.teamCount
    : (teamOpts[0] ?? 2);
  const players: LobbyPlayer[] = room.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    connected: p.connected,
    team: teamOpts.length > 0 ? TEAMS[i % teamCount] : null,
    avatar: p.avatar,
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    players,
    settings: { ...room.settings, teamCount },
    started: room.started,
    validCounts: Object.keys(HAND_SIZES).map(Number),
    spectatorCount: room.spectators.length,
  };
}

export function startGame(room: Room): string | null {
  const n = room.players.length;
  const teamOpts = teamOptionsFor(n);
  if (teamOpts.length === 0) {
    return `Player count must be one of: ${Object.keys(HAND_SIZES).join(', ')} (add or remove bots).`;
  }
  const teamCount = teamOpts.includes(room.settings.teamCount)
    ? room.settings.teamCount
    : teamOpts[0];
  room.settings.teamCount = teamCount;
  const seated = room.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    team: TEAMS[i % teamCount],
  }));
  room.game = createGame(seated, { ...room.settings });
  // carry avatars onto the game players so the board can show them
  for (const gp of room.game.players) {
    gp.avatar = room.players.find((rp) => rp.id === gp.id)?.avatar;
  }
  room.started = true;
  room.undoSnapshot = null;
  room.undoRequest = null;
  return null;
}

export function resetForRematch(room: Room) {
  // rotate seating so a different player starts
  room.players.push(room.players.shift()!);
  room.started = false;
  room.game = null;
  room.undoSnapshot = null;
  room.undoRequest = null;
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

/** Run bot turns (with humanlike delays). Calls `broadcast` after each bot action. */
export function scheduleBots(room: Room, broadcast: () => void) {
  const game = room.game;
  if (!game || game.winner || game.stalemate) return;
  const current = game.players[game.turn];
  const roomPlayer = room.players.find((p) => p.id === current.id);
  const actsAsBot = current.isBot || (roomPlayer && !roomPlayer.connected && roomPlayer.isBot);
  if (!actsAsBot) return;
  if (room.botTimer) return; // already scheduled

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const g = room.game;
    if (!g || g.winner || g.stalemate) return;
    const p = g.players[g.turn];
    if (!p) return;
    const rp = room.players.find((x) => x.id === p.id);
    const stillBot = p.isBot || (rp && !rp.connected && rp.isBot);
    if (!stillBot) return;

    const move = chooseBotMove(g, p);
    const res = applyMove(g, p.id, move);
    if (!res.ok) {
      // failsafe: compute a guaranteed-legal move directly, then pass. Because
      // forceLegalMove finds any legal placement/removal (and pass is legal
      // exactly when none exists), this can never leave the turn stuck.
      const forced = forceLegalMove(g, p);
      const advanced =
        applyMove(g, p.id, forced).ok || applyMove(g, p.id, { type: 'pass' }).ok;
      if (!advanced) {
        console.error(`Bot ${p.name} could not move (${res.error}); forcing turn skip.`);
      }
    }
    // strict mode: bots always claim their draw immediately
    if (g.settings.strictDraw && (g.pendingDraws[p.id] ?? 0) > 0) {
      applyMove(g, p.id, { type: 'draw' });
    }
    // a bot move closes any human's undo window
    room.undoSnapshot = null;
    room.undoRequest = null;
    broadcast();
    scheduleBots(room, broadcast); // chain (dead-card exchange keeps same turn, or next bot)
  }, 800 + Math.random() * 1000);
}

export function clientStateFor(room: Room, playerId: string) {
  if (!room.game) return null;
  return toClientState(room.game, playerId);
}

export function sweepIdleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyConnected = room.players.some((p) => !p.isBot && p.connected);
    // sweep on inactivity, not age, so a long live game is never deleted; a
    // room with no connected humans is reclaimed after a grace period
    const idleMs = now - room.lastActivityAt;
    if (!anyConnected && idleMs > 1000 * 60 * 30) deleteRoom(code);
  }
}
