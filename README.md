# Sequence

A full implementation of the classic **Sequence** board game with real-time online
multiplayer, AI bots, rich animations and sound.

## Tech stack

- **Client:** React 19 + TypeScript + Vite, Framer Motion animations, Zustand state, WebAudio sound synth
- **Server:** Node.js + Express + Socket.IO (authoritative game server)
- **Shared:** pure TypeScript game engine (`shared/`) used by both server and AI bots

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173, create a room, add AI bots or share the room code
with friends on your network, and deal the cards.

- `npm run build && npm start` builds for production; the server then serves the built
  client at http://localhost:3001.

## Test suites

Two independent layers keep the game honest:

- `npm run selftest` runs the **engine unit tests**. It validates the board layout, asserts
  every official rule individually (77 checks), and simulates full bot-vs-bot
  games across every player count (720 seeded games).
- `npm run playtest` runs the **networked play-tester**. With the server running
  (`npm start`), connects real socket.io clients and plays full games through
  the actual network + room layer, plus reconnect, AI-takeover-on-leave, host
  migration, and illegal-move scenarios. This one exercises the real server
  rather than the in-process engine.

## Play modes

- **Vs computer:** one tap for 1v1, 3-way, or 2v2 against AI bots.
- **With friends:** create a room and share the 5-letter code (the lobby shows
  a ready-to-send LAN link); friends on the same Wi-Fi join instantly.
- **Pass & Play:** local hotseat on a single device; runs the game engine
  entirely client-side (works fully offline), with a pass-the-device screen that
  hides each player's hand between turns.
- **Spectate:** watch any room by code (hands hidden, live board).

## Extra features

- **Bot difficulty:** easy / medium / hard AI (lobby + quick play + solo).
- **Turn timer:** optional 30s / 60s shot clock; auto-plays a legal move on timeout.
- **Undo:** request a take-back of your last move; opponents approve (auto in solo vs bots).
- **Emotes:** quick reactions that float on everyone's screen.
- **Avatars & win stats:** pick an emoji avatar; wins/losses/win-rate saved locally.
- **Colorblind mode:** distinct symbol on each team's chips.
- **Sound & haptics:** synthesized cues plus vibration on supported phones; all toggleable in Settings.
- **End-of-game recap:** sequences and chips per team.

## Game features

- Official 10×10 board (each of the 48 card faces appears exactly twice, 4 free corners)
- 2 / 3 / 4 / 6 / 8 / 9 players, 2 or 3 teams, official hand sizes
- Two-eyed Jacks (♦ ♣) wild, one-eyed Jacks (♠ ♥) remove; completed sequences are protected
- Dead-card exchange, no-legal-move pass, deck reshuffle
- 2 teams need 2 sequences, 3 teams need 1; sequences may share one chip
- Optional **strict draw rule**: forget to draw before the next player moves and you
  forfeit the card for the rest of the game
- Rooms with 5-letter join codes, chat, reconnect after refresh, AI autopilot for
  players who drop, rematch with rotated seating
- Heuristic AI bots that build lines, block threats and value their Jacks

## Known limitations (online play)

Online multiplayer is deliberately **serverless and free**. Clients relay through a
public MQTT broker, and one player's browser runs the authoritative game engine.
That choice has real trade-offs worth knowing:

- **The room code is the only secret.** Anyone who learns the 5-character code can
  subscribe to the room's topics on the public broker, observe traffic, and publish
  messages claiming to be another player. Treat codes as private; don't post them
  publicly.
- **The host and the designated heir hold the full game state.** The host runs
  the engine, so its browser necessarily holds every player's hand. Host migration
  requires the heir to keep a full snapshot so it can take over instantly, so the
  heir holds it too. Ordinary state updates *are* redacted per player (each player
  is sent only their own hand), but a determined host or heir could inspect the
  rest. **This is not cheat-proof for competitive play.**

Closing these properly needs either a real server or end-to-end encryption between
players, both of which conflict with the zero-hosting-cost goal. For casual games
with people you know, the current design is fine. Just don't treat it as
tournament-grade.
