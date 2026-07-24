import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { Server, type Socket } from 'socket.io';
import { applyMove, forceLegalMove } from '../../shared/game';
import type { ChatMessage, EmoteMessage, Move } from '../../shared/types';
import {
  MAX_ROOMS,
  addBot,
  clientStateFor,
  createRoom,
  deleteRoom,
  ensureHost,
  getRoom,
  resetForRematch,
  restoreSnapshot,
  roomCount,
  roomInfo,
  scheduleBots,
  snapshotGame,
  startGame,
  sweepIdleRooms,
  touchRoom,
  type Room,
} from './rooms';

// A single bad packet must never take the whole server (all rooms) down.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SEQUENCE_PORT) || 3001;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

// LAN addresses so the lobby can show friends a join link
app.get('/api/netinfo', (_req, res) => {
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.'))
        addresses.push(iface.address);
    }
  }
  const rank = (ip: string) =>
    ip.startsWith('192.168.')
      ? 0
      : /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
        ? 1
        : ip.startsWith('10.')
          ? 2
          : 3;
  addresses.sort((a, b) => rank(a) - rank(b));
  res.json({ port: PORT, addresses });
});

// serve the built client if it exists (production)
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

interface SocketCtx {
  playerId: string | null;
  roomCode: string | null;
}

const ctxOf = new Map<string, SocketCtx>();

// ---- payload validation helpers (all socket input is untrusted) ----
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const asStr = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.slice(0, max) : '';
const cleanName = (v: unknown): string => asStr(v, 20).trim().slice(0, 20) || 'Player';
const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v < hi;

// lobby-disconnect grace: keep a seat reserved briefly so a refresh restores it
const GRACE_MS = 12_000;
const leaveTimers = new Map<string, NodeJS.Timeout>();
const timerKey = (code: string, pid: string) => `${code}:${pid}`;
function cancelLeaveTimer(code: string, pid: string) {
  const k = timerKey(code, pid);
  const t = leaveTimers.get(k);
  if (t) {
    clearTimeout(t);
    leaveTimers.delete(k);
  }
}

// very light per-socket rate limiting
const rateState = new Map<string, Map<string, number[]>>();
function rateOk(socketId: string, key: string, max: number, windowMs: number): boolean {
  let m = rateState.get(socketId);
  if (!m) rateState.set(socketId, (m = new Map()));
  const now = Date.now();
  const arr = (m.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  m.set(key, arr);
  return arr.length <= max;
}

function broadcastRoom(room: Room) {
  const info = roomInfo(room);
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('roomUpdate', info);
  }
  for (const s of room.spectators) io.to(s.socketId).emit('roomUpdate', info);
}
function broadcastGame(room: Room) {
  if (!room.game) return;
  for (const p of room.players) {
    if (!p.socketId) continue;
    const st = clientStateFor(room, p.id);
    if (!st) continue;
    st.spectatorCount = room.spectators.length;
    // an undo request is shown to everyone EXCEPT the requester (they can't self-approve)
    st.undoRequest =
      room.undoRequest && room.undoRequest.byId !== p.id ? room.undoRequest : null;
    io.to(p.socketId).emit('gameState', st);
  }
  // spectators see the board with no hand and no controls
  for (const s of room.spectators) {
    const st = clientStateFor(room, '__spectator__');
    if (!st) continue;
    st.spectator = true;
    st.spectatorCount = room.spectators.length;
    io.to(s.socketId).emit('gameState', st);
  }
}
function broadcastAll(room: Room) {
  broadcastRoom(room);
  if (room.game) broadcastGame(room);
}

// ---- turn timer (shot clock) ----
function clearTurnTimer(room: Room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}
function armTurnTimer(room: Room) {
  clearTurnTimer(room);
  const g = room.game;
  if (!g || g.winner || g.stalemate) return;
  const secs = g.settings.turnSeconds ?? 0;
  if (secs <= 0) return;
  const cur = g.players[g.turn];
  const rp = room.players.find((p) => p.id === cur.id);
  // only time connected human seats; bot/AI seats are driven by scheduleBots
  if (!rp || cur.isBot || !rp.connected) return;
  const deadline = (g.turnStartedAt ?? Date.now()) + secs * 1000;
  const ms = Math.max(0, deadline - Date.now());
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    const gg = room.game;
    if (!gg || gg.winner || gg.stalemate) return;
    const p = gg.players[gg.turn];
    if (!p || p.id !== cur.id) return; // turn already moved on
    // auto-play a guaranteed-legal move on timeout
    applyMove(gg, p.id, forceLegalMove(gg, p));
    if (gg.settings.strictDraw && (gg.pendingDraws[p.id] ?? 0) > 0)
      applyMove(gg, p.id, { type: 'draw' });
    room.undoSnapshot = null;
    room.undoRequest = null;
    afterGameChange(room);
  }, ms);
}
/** Broadcast + drive bots + (re)arm the turn timer after any game state change. */
function afterGameChange(room: Room) {
  broadcastGame(room);
  armTurnTimer(room);
  scheduleBots(room, () => {
    broadcastGame(room);
    armTurnTimer(room);
  });
}

io.on('connection', (socket: Socket) => {
  ctxOf.set(socket.id, { playerId: null, roomCode: null });

  const fail = (message: string) => socket.emit('errorMsg', message);
  const myRoom = (): Room | null => {
    const ctx = ctxOf.get(socket.id);
    if (!ctx?.roomCode) return null;
    return getRoom(ctx.roomCode) ?? null;
  };

  /** Wrap a handler so a thrown error becomes an errorMsg, never a crash. */
  const safe =
    (fn: (payload: Record<string, unknown>) => void) =>
    (payload?: unknown) => {
      try {
        fn(asObj(payload));
      } catch (err) {
        console.error(`[handler error]`, err);
        fail('Something went wrong processing that request.');
      }
    };

  /** Leave whatever room we're currently in (immediate; used before creating another). */
  const leaveCurrent = () => {
    const ctx = ctxOf.get(socket.id);
    if (!ctx?.roomCode) return;
    const room = getRoom(ctx.roomCode);
    if (room) {
      // drop a spectator seat if we held one
      if (room.spectators.some((s) => s.socketId === socket.id)) {
        room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);
        broadcastRoom(room);
        if (room.game) broadcastGame(room);
      }
      if (ctx.playerId) handleLeave(room, ctx.playerId, true);
    }
    ctxOf.set(socket.id, { playerId: ctx.playerId, roomCode: null });
  };

  socket.on(
    'createRoom',
    safe((p) => {
      if (!rateOk(socket.id, 'create', 5, 10_000)) return fail('Slow down a moment.');
      if (roomCount() >= MAX_ROOMS) return fail('The server is at capacity, try again shortly.');
      const playerId = asStr(p.playerId, 64) || randomUUID();
      leaveCurrent();
      const token = randomUUID();
      const room = createRoom(cleanName(p.name), playerId, token, asStr(p.avatar, 8) || undefined);
      room.players[0].socketId = socket.id;
      ctxOf.set(socket.id, { playerId, roomCode: room.code });
      socket.emit('roomJoined', { code: room.code, playerId, token });
      broadcastRoom(room);
    }),
  );

  /** one tap: room + bots + deal, straight into the game */
  socket.on(
    'quickPlay',
    safe((p) => {
      if (!rateOk(socket.id, 'create', 5, 10_000)) return fail('Slow down a moment.');
      if (roomCount() >= MAX_ROOMS) return fail('The server is at capacity, try again shortly.');
      const players = isIntIn(p.players, 2, 7) && [2, 3, 4, 6].includes(p.players) ? p.players : 2;
      const playerId = asStr(p.playerId, 64) || randomUUID();
      leaveCurrent();
      const token = randomUUID();
      const room = createRoom(cleanName(p.name), playerId, token, asStr(p.avatar, 8) || undefined);
      room.players[0].socketId = socket.id;
      ctxOf.set(socket.id, { playerId, roomCode: room.code });
      for (let i = 0; i < players - 1; i++) addBot(room);
      room.settings.teamCount = players === 3 ? 3 : 2;
      if (p.difficulty === 'easy' || p.difficulty === 'medium' || p.difficulty === 'hard')
        room.settings.botDifficulty = p.difficulty;
      const err = startGame(room);
      if (err) return fail(err);
      socket.emit('roomJoined', { code: room.code, playerId, token });
      broadcastRoom(room);
      afterGameChange(room);
    }),
  );

  socket.on(
    'joinRoom',
    safe((p) => {
      const code = asStr(p.code, 5).toUpperCase();
      const playerId = asStr(p.playerId, 64);
      const token = asStr(p.token, 64);
      if (!code || !playerId) return fail('Invalid join request.');
      const room = getRoom(code);
      if (!room) return fail('Room not found. Check the code.');

      const existing = room.players.find((pl) => pl.id === playerId);
      if (existing) {
        // reclaiming a seat: if it has a secret and is actively held by someone
        // else, require the matching token, prevents seat hijacking
        if (existing.token && existing.connected && existing.socketId !== socket.id) {
          if (token !== existing.token) return fail('That seat is already taken.');
        }
        cancelLeaveTimer(room.code, playerId);
        // signal a previous tab that the session moved here
        if (existing.socketId && existing.socketId !== socket.id) {
          io.to(existing.socketId).emit('sessionMoved');
        }
        existing.connected = true;
        existing.socketId = socket.id;
        const av = asStr(p.avatar, 8);
        if (av) existing.avatar = av;
        if (!existing.token) existing.token = token || randomUUID();
        if (existing.isBot) {
          existing.isBot = false;
          const gp = room.game?.players.find((pl) => pl.id === playerId);
          if (gp) gp.isBot = false;
        }
        ensureHost(room);
        ctxOf.set(socket.id, { playerId, roomCode: room.code });
        socket.emit('roomJoined', { code: room.code, playerId, token: existing.token });
        touchRoom(room);
        broadcastRoom(room);
        if (room.game) afterGameChange(room);
        return;
      }

      if (room.started) return fail('That game has already started.');
      if (room.players.length >= 12) return fail('Room is full.');
      const newToken = token || randomUUID();
      room.players.push({
        id: playerId,
        token: newToken,
        name: cleanName(p.name),
        isBot: false,
        connected: true,
        socketId: socket.id,
        avatar: asStr(p.avatar, 8) || undefined,
      });
      ctxOf.set(socket.id, { playerId, roomCode: room.code });
      socket.emit('roomJoined', { code: room.code, playerId, token: newToken });
      touchRoom(room);
      broadcastRoom(room);
    }),
  );

  socket.on(
    'addBot',
    safe(() => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx) return;
      if (room.hostId !== ctx.playerId) return fail('Only the host can add bots.');
      if (!addBot(room)) return fail('Cannot add another bot.');
      touchRoom(room);
      broadcastRoom(room);
    }),
  );

  socket.on(
    'removePlayer',
    safe((p) => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx) return;
      if (room.hostId !== ctx.playerId) return fail('Only the host can remove players.');
      if (room.started) return fail('The game already started.');
      const id = asStr(p.id, 64);
      if (id === room.hostId) return fail("The host can't be removed.");
      const idx = room.players.findIndex((pl) => pl.id === id);
      if (idx === -1) return;
      const [removed] = room.players.splice(idx, 1);
      if (removed.socketId) {
        io.to(removed.socketId).emit('kicked');
        ctxOf.set(removed.socketId, { playerId: removed.id, roomCode: null });
      }
      touchRoom(room);
      broadcastRoom(room);
    }),
  );

  socket.on(
    'updateSettings',
    safe((p) => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx) return;
      if (room.hostId !== ctx.playerId) return fail('Only the host can change settings.');
      if (room.started) return;
      if (p.teamCount === 2 || p.teamCount === 3) room.settings.teamCount = p.teamCount;
      if (typeof p.strictDraw === 'boolean') room.settings.strictDraw = p.strictDraw;
      if (p.botDifficulty === 'easy' || p.botDifficulty === 'medium' || p.botDifficulty === 'hard')
        room.settings.botDifficulty = p.botDifficulty;
      if (isIntIn(p.turnSeconds, 0, 601)) room.settings.turnSeconds = p.turnSeconds;
      touchRoom(room);
      broadcastRoom(room);
    }),
  );

  socket.on(
    'startGame',
    safe(() => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx) return;
      if (room.hostId !== ctx.playerId) return fail('Only the host can start the game.');
      if (room.started) return;
      const err = startGame(room);
      if (err) return fail(err);
      touchRoom(room);
      broadcastRoom(room);
      afterGameChange(room);
    }),
  );

  socket.on(
    'playMove',
    safe((p) => {
      if (!rateOk(socket.id, 'move', 40, 1000)) return; // silently drop floods
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room?.game || !ctx?.playerId) return;
      const move = validateMove(p);
      if (!move) return fail('Invalid move.');
      // snapshot BEFORE the move so the mover can request a single-level undo
      const wasTurn = room.game.players[room.game.turn]?.id;
      snapshotGame(room);
      const res = applyMove(room.game, ctx.playerId, move);
      if (!res.ok) {
        room.undoSnapshot = null;
        return fail(res.error ?? 'Illegal move.');
      }
      // a fresh move invalidates any pending undo request
      room.undoRequest = null;
      void wasTurn;
      touchRoom(room);
      afterGameChange(room);
    }),
  );

  socket.on(
    'rematch',
    safe(() => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx?.playerId) return;
      // any seated human may start the rematch (so a disconnected host can't block it)
      const me = room.players.find((pl) => pl.id === ctx.playerId && !pl.isBot);
      if (!me) return fail('Only a player can start a rematch.');
      if (!room.game || (!room.game.winner && !room.game.stalemate))
        return fail('The game is not over yet.');
      resetForRematch(room);
      ensureHost(room);
      const err = startGame(room);
      if (err) return fail(err);
      touchRoom(room);
      broadcastRoom(room);
      afterGameChange(room);
    }),
  );

  // ---- spectators, emotes, undo ----

  socket.on(
    'joinSpectate',
    safe((p) => {
      const code = asStr(p.code, 5).toUpperCase();
      if (!code) return fail('Invalid room code.');
      const room = getRoom(code);
      if (!room) return fail('Room not found. Check the code.');
      leaveCurrent();
      room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);
      room.spectators.push({ socketId: socket.id, name: cleanName(p.name) });
      ctxOf.set(socket.id, { playerId: asStr(p.playerId, 64) || null, roomCode: room.code });
      socket.emit('spectating', { code: room.code });
      broadcastRoom(room);
      // refresh players (so their spectatorCount updates) and send the watcher its view
      if (room.game) {
        broadcastGame(room);
        const st = clientStateFor(room, '__spectator__');
        if (st) {
          st.spectator = true;
          st.spectatorCount = room.spectators.length;
          socket.emit('gameState', st);
        }
      }
    }),
  );

  socket.on(
    'emote',
    safe((p) => {
      if (!rateOk(socket.id, 'emote', 5, 4000)) return;
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx?.playerId) return;
      const player = room.players.find((pl) => pl.id === ctx.playerId);
      if (!player) return;
      const emote = asStr(p.emote, 8);
      if (!emote) return;
      const gp = room.game?.players.find((pl) => pl.id === player.id);
      const msg: EmoteMessage = {
        playerId: player.id,
        name: player.name,
        team: gp?.team ?? null,
        emote,
        ts: Date.now(),
      };
      for (const pl of room.players) if (pl.socketId) io.to(pl.socketId).emit('emote', msg);
      for (const s of room.spectators) io.to(s.socketId).emit('emote', msg);
    }),
  );

  socket.on(
    'requestUndo',
    safe(() => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room?.game || !ctx?.playerId) return;
      if (!room.undoSnapshot) return fail('Nothing to undo.');
      // only the player who made the most recent move may ask to undo it
      const last = room.game.log[room.game.log.length - 1];
      if (!last || last.playerId !== ctx.playerId) return fail('You can only undo your own last move.');
      const humanOpponents = room.players.filter(
        (pl) => !pl.isBot && pl.connected && pl.id !== ctx.playerId,
      );
      const me = room.players.find((pl) => pl.id === ctx.playerId);
      if (humanOpponents.length === 0) {
        // solo vs bots, no one to approve, so undo immediately
        if (restoreSnapshot(room)) {
          touchRoom(room);
          afterGameChange(room);
        }
        return;
      }
      room.undoRequest = { byId: ctx.playerId, byName: me?.name ?? 'A player' };
      broadcastGame(room);
    }),
  );

  socket.on(
    'respondUndo',
    safe((p) => {
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room?.game || !ctx?.playerId || !room.undoRequest) return;
      if (room.undoRequest.byId === ctx.playerId) return; // can't approve your own
      const approver = room.players.find((pl) => pl.id === ctx.playerId && !pl.isBot);
      if (!approver) return;
      if (p.approve === true) {
        if (restoreSnapshot(room)) {
          touchRoom(room);
          afterGameChange(room);
        }
      } else {
        room.undoRequest = null;
        broadcastGame(room);
      }
    }),
  );

  socket.on(
    'chat',
    safe((p) => {
      if (!rateOk(socket.id, 'chat', 6, 4000)) return;
      const room = myRoom();
      const ctx = ctxOf.get(socket.id);
      if (!room || !ctx?.playerId) return;
      const player = room.players.find((pl) => pl.id === ctx.playerId);
      if (!player) return;
      const clean = asStr(p.text, 300).trim().slice(0, 300);
      if (!clean) return;
      const gamePlayer = room.game?.players.find((pl) => pl.id === player.id);
      const msg: ChatMessage = {
        playerId: player.id,
        name: player.name,
        team: gamePlayer?.team ?? null,
        text: clean,
        ts: Date.now(),
      };
      touchRoom(room);
      for (const pl of room.players) {
        if (pl.socketId) io.to(pl.socketId).emit('chat', msg);
      }
    }),
  );

  socket.on(
    'leaveRoom',
    safe(() => {
      leaveCurrent();
    }),
  );

  socket.on('disconnect', () => {
    const room = myRoom();
    const ctx = ctxOf.get(socket.id);
    ctxOf.delete(socket.id);
    rateState.delete(socket.id);
    if (!room) return;
    // spectator leaving
    const wasSpectator = room.spectators.some((s) => s.socketId === socket.id);
    if (wasSpectator) {
      room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);
      broadcastRoom(room);
      if (room.game) broadcastGame(room);
      return;
    }
    if (!ctx?.playerId) return;
    const player = room.players.find((p) => p.id === ctx.playerId);
    if (!player) return;
    // a newer connection already owns this seat (second tab), ignore stale close
    if (player.socketId && player.socketId !== socket.id) return;
    // hand off to another live socket for the same player if one exists
    for (const [sid, c] of ctxOf) {
      if (sid !== socket.id && c.playerId === ctx.playerId && c.roomCode === ctx.roomCode) {
        player.socketId = sid;
        player.connected = true;
        broadcastAll(room);
        return;
      }
    }
    player.connected = false;
    player.socketId = null;

    if (!room.started) {
      // lobby: keep the seat reserved briefly so a refresh restores it
      broadcastRoom(room);
      const code = room.code;
      const pid = ctx.playerId;
      cancelLeaveTimer(code, pid);
      leaveTimers.set(
        timerKey(code, pid),
        setTimeout(() => {
          leaveTimers.delete(timerKey(code, pid));
          const r = getRoom(code);
          const pl = r?.players.find((x) => x.id === pid);
          if (r && pl && !pl.connected) handleLeave(r, pid, true);
        }, GRACE_MS),
      );
    } else {
      // in game: AI takes over the seat, host migrates if needed, game continues
      player.isBot = true;
      const gp = room.game?.players.find((p) => p.id === ctx.playerId);
      if (gp) gp.isBot = true;
      ensureHost(room);
      broadcastRoom(room);
      afterGameChange(room);
    }
  });

  function handleLeave(room: Room, playerId: string, immediate: boolean) {
    cancelLeaveTimer(room.code, playerId);
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    if (!room.started) {
      room.players.splice(idx, 1);
      if (room.players.length === 0 || room.players.every((p) => p.isBot)) {
        deleteRoom(room.code);
        return;
      }
      ensureHost(room);
      broadcastRoom(room);
    } else {
      const player = room.players[idx];
      player.connected = false;
      player.socketId = null;
      player.isBot = true;
      const gp = room.game?.players.find((p) => p.id === playerId);
      if (gp) gp.isBot = true;
      ensureHost(room);
      broadcastRoom(room);
      afterGameChange(room);
    }
    void immediate;
  }
});

/** Runtime validation of a client-supplied move (types are compile-time only). */
function validateMove(p: Record<string, unknown>): Move | null {
  const type = p.type;
  if (type === 'draw' || type === 'pass') return { type };
  const card = asStr(p.card, 3);
  if (!card) return null;
  if (type === 'exchangeDead') return { type, card };
  if (type === 'place' || type === 'remove') {
    if (!isIntIn(p.r, 0, 10) || !isIntIn(p.c, 0, 10)) return null;
    return { type, card, r: p.r, c: p.c };
  }
  return null;
}

setInterval(sweepIdleRooms, 1000 * 60 * 5);

httpServer.listen(PORT, () => {
  console.log(`Sequence server listening on http://localhost:${PORT}`);
});
