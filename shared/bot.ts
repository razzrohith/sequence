import { WINDOWS_BY_CELL, isCorner } from './board';
import {
  isDeadCard,
  isJack,
  isOneEyed,
  isTwoEyed,
  legalCellsFor,
} from './game';
import type { GameCore, Move, ServerPlayer, Team } from './types';

/**
 * Heuristic bot. Scores every playable (card, cell) pair by how much it
 * advances the bot's own lines and how much it blocks opponents, with a
 * conservation penalty on jacks so they're saved for high-impact plays.
 */

const OWN_VALUE = [1, 5, 24, 130, 100000]; // by chips already in an open window
const BLOCK_VALUE = [0, 1, 6, 45, 22000]; // opponent chips in a window we deny

interface WindowEval {
  ownOpen: boolean;
  ownCount: number;
  oppOpenFor: Team | null;
  oppCount: number;
}

function evalWindow(
  game: GameCore,
  cells: Array<[number, number]>,
  team: Team,
  skip: [number, number] | null,
): WindowEval {
  let ownCount = 0;
  let ownOpen = true;
  const teamCounts = new Map<Team, number>();
  let hasEmpty = false;
  const present = new Set<Team>();

  for (const [r, c] of cells) {
    if (skip && r === skip[0] && c === skip[1]) {
      hasEmpty = true;
      continue;
    }
    if (isCorner(r, c)) {
      ownCount++;
      for (const t of ['red', 'blue', 'green'] as Team[]) {
        teamCounts.set(t, (teamCounts.get(t) ?? 0) + 1);
      }
      continue;
    }
    const chip = game.board[r][c].chip;
    if (chip === null) {
      hasEmpty = true;
      continue;
    }
    present.add(chip);
    teamCounts.set(chip, (teamCounts.get(chip) ?? 0) + 1);
    if (chip === team) ownCount++;
    else ownOpen = false;
  }

  // an opponent window is "open" if exactly one opposing team occupies it
  let oppOpenFor: Team | null = null;
  let oppCount = 0;
  const opponents = [...present].filter((t) => t !== team);
  if (opponents.length === 1) {
    oppOpenFor = opponents[0];
    oppCount = teamCounts.get(opponents[0]) ?? 0;
  }
  void hasEmpty;
  return { ownOpen, ownCount, oppOpenFor, oppCount };
}

function scorePlacement(
  game: GameCore,
  team: Team,
  r: number,
  c: number,
  weights: Weights = BALANCED_WEIGHTS,
): number {
  let score = 0;
  const windows = WINDOWS_BY_CELL.get(`${r},${c}`) ?? [];
  for (const w of windows) {
    const ev = evalWindow(game, w, team, [r, c]);
    if (ev.ownOpen) {
      const n = Math.min(ev.ownCount, 4);
      score += OWN_VALUE[n] * weights.own;
    }
    if (ev.oppOpenFor) {
      const n = Math.min(ev.oppCount, 4);
      score += BLOCK_VALUE[n] * weights.block;
    }
  }
  return score;
}

function scoreRemoval(game: GameCore, team: Team, r: number, c: number): number {
  const victim = game.board[r][c].chip;
  if (!victim) return 0;
  let best = 0;
  let total = 0;
  const windows = WINDOWS_BY_CELL.get(`${r},${c}`) ?? [];
  for (const w of windows) {
    const ev = evalWindow(game, w, victim, null);
    if (ev.ownOpen) {
      // window open for the victim, through this chip
      best = Math.max(best, ev.ownCount);
      total += OWN_VALUE[Math.min(ev.ownCount, 4)] / 8;
    }
  }
  if (best >= 4) return 65000;
  return total;
}

import type { BotDifficulty } from './types';

/**
 * Difficulty tuning:
 * - easy:   lots of scoring noise + sometimes plays a random legal move, wastes
 *           jacks freely (weak, beatable).
 * - medium: the well-tuned default.
 * - hard:   near-zero noise, values jacks properly (very sharp).
 */
const DIFFICULTY = {
  easy: { noise: 55, randomChance: 0.35, jackTax: 20 },
  medium: { noise: 3, randomChance: 0, jackTax: 60 },
  hard: { noise: 0.5, randomChance: 0, jackTax: 45 },
} as const;

/** How a personality bends the scoring: >1 own = pushes its own lines harder,
 * >1 block = defends more, >1 jack = hoards power cards (higher jack "tax"). */
export interface Weights {
  own: number;
  block: number;
  jack: number;
}
const BALANCED_WEIGHTS: Weights = { own: 1, block: 1, jack: 1 };

export type BotPersonality = 'balanced' | 'aggressive' | 'defensive' | 'trickster';

/** Personality profiles: flavor + how they weight the scoring. `balanced` is
 * exactly the tuned default (all weights 1), so unspecified bots are unchanged. */
export const PERSONALITIES: Record<
  BotPersonality,
  { label: string; emoji: string; weights: Weights }
> = {
  balanced: { label: 'Balanced', emoji: '🎯', weights: BALANCED_WEIGHTS },
  aggressive: { label: 'Aggressive', emoji: '🗡️', weights: { own: 1.4, block: 0.55, jack: 0.6 } },
  defensive: { label: 'Defensive', emoji: '🛡️', weights: { own: 0.85, block: 1.9, jack: 1.25 } },
  trickster: { label: 'Trickster', emoji: '🃏', weights: { own: 1.05, block: 1.1, jack: 0.45 } },
};

export function chooseBotMove(
  game: GameCore,
  player: ServerPlayer,
  difficulty: BotDifficulty = game.settings.botDifficulty ?? 'medium',
  personality: BotPersonality = 'balanced',
): Move {
  const team = player.team;
  const tune = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const weights = (PERSONALITIES[personality] ?? PERSONALITIES.balanced).weights;

  // 1) exchange a dead card if we have one (free value), hard/medium always do;
  // easy sometimes skips it (more human-like weak play)
  if (
    game.settings.allowDeadExchange !== false &&
    !game.deadExchangedThisTurn &&
    !(difficulty === 'easy' && Math.random() < 0.4)
  ) {
    const dead = player.hand.find((card) => isDeadCard(game, card));
    if (dead) return { type: 'exchangeDead', card: dead };
  }

  // easy bots sometimes just play a random legal move
  if (tune.randomChance > 0 && Math.random() < tune.randomChance) {
    const rnd = randomLegalMove(game, player);
    if (rnd) return rnd;
  }

  let best: { move: Move; score: number } | null = null;
  const noise = () => Math.random() * tune.noise;

  for (const card of player.hand) {
    const cells = legalCellsFor(game, team, card);
    if (cells.length === 0) continue;

    if (isOneEyed(card)) {
      // a one-eyed jack removes an opponent chip: a defensive act, so it scales
      // with the block weight, and the jack tax with the jack (hoarding) weight
      for (const [r, c] of cells) {
        const s = scoreRemoval(game, team, r, c) * weights.block - 90 * weights.jack + noise();
        if (!best || s > best.score) best = { move: { type: 'remove', card, r, c }, score: s };
      }
      continue;
    }

    const jackTax = isTwoEyed(card) ? tune.jackTax * weights.jack : 0;
    for (const [r, c] of cells) {
      const s = scorePlacement(game, team, r, c, weights) - jackTax + noise();
      if (!best || s > best.score) best = { move: { type: 'place', card, r, c }, score: s };
    }
  }

  if (best) return best.move;

  // no legal move: try exchanging any dead card, else pass
  if (game.settings.allowDeadExchange !== false && !game.deadExchangedThisTurn) {
    const dead = player.hand.find((card) => isDeadCard(game, card) && !isJack(card));
    if (dead) return { type: 'exchangeDead', card: dead };
  }
  return { type: 'pass' };
}

function randomLegalMove(game: GameCore, player: ServerPlayer): Move | null {
  const options: Move[] = [];
  for (const card of player.hand) {
    const cells = legalCellsFor(game, player.team, card);
    for (const [r, c] of cells) {
      options.push(
        isOneEyed(card) ? { type: 'remove', card, r, c } : { type: 'place', card, r, c },
      );
    }
  }
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}
