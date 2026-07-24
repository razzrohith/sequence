import type { Card } from './types';

/**
 * The real Sequence board, in the orientation it is printed: the top row runs
 * 6♦ 7♦ 8♦ 9♦ 10♦ Q♦ K♦ A♦ between the free corners, and the bottom row runs
 * 9♠ down to 2♠. 'XX' marks the four free corners. T = 10.
 */
export const BOARD_LAYOUT: string[][] = [
  ['XX', '6D', '7D', '8D', '9D', 'TD', 'QD', 'KD', 'AD', 'XX'],
  ['5D', '3H', '2H', '2S', '3S', '4S', '5S', '6S', '7S', 'AC'],
  ['4D', '4H', 'KD', 'AD', 'AC', 'KC', 'QC', 'TC', '8S', 'KC'],
  ['3D', '5H', 'QD', 'QH', 'TH', '9H', '8H', '9C', '9S', 'QC'],
  ['2D', '6H', 'TD', 'KH', '3H', '2H', '7H', '8C', 'TS', 'TC'],
  ['AS', '7H', '9D', 'AH', '4H', '5H', '6H', '7C', 'QS', '9C'],
  ['KS', '8H', '8D', '2C', '3C', '4C', '5C', '6C', 'KS', '8C'],
  ['QS', '9H', '7D', '6D', '5D', '4D', '3D', '2D', 'AS', '7C'],
  ['TS', 'TH', 'QH', 'KH', 'AH', '2C', '3C', '4C', '5C', '6C'],
  ['XX', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S', 'XX'],
];

export const SIZE = 10;

export function isCorner(r: number, c: number): boolean {
  return (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1);
}

export function cardAt(r: number, c: number, layout: string[][] = BOARD_LAYOUT): Card | null {
  const v = layout[r][c];
  return v === 'XX' ? null : v;
}

/** card code -> its two cells, for any layout (games may use a shuffled one) */
const POSITION_CACHE = new WeakMap<string[][], Map<Card, Array<[number, number]>>>();
export function positionsFor(layout: string[][]): Map<Card, Array<[number, number]>> {
  const cached = POSITION_CACHE.get(layout);
  if (cached) return cached;
  const m = new Map<Card, Array<[number, number]>>();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const card = cardAt(r, c, layout);
      if (!card) continue;
      const arr = m.get(card) ?? [];
      arr.push([r, c]);
      m.set(card, arr);
    }
  }
  POSITION_CACHE.set(layout, m);
  return m;
}

/**
 * A randomised board: the same 48 faces twice over, dealt to the 96 non-corner
 * cells in a new order. Corners stay free, so every rule still holds.
 */
export function shuffledLayout(rng: () => number = Math.random): string[][] {
  const faces: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (BOARD_LAYOUT[r][c] !== 'XX') faces.push(BOARD_LAYOUT[r][c]);
    }
  }
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  let k = 0;
  const out: string[][] = [];
  for (let r = 0; r < SIZE; r++) {
    const row: string[] = [];
    for (let c = 0; c < SIZE; c++) row.push(isCorner(r, c) ? 'XX' : faces[k++]);
    out.push(row);
  }
  return out;
}

/** Map from card code -> its (up to 2) positions on the board */
export const CARD_POSITIONS: Map<Card, Array<[number, number]>> = (() => {
  const m = new Map<Card, Array<[number, number]>>();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const card = cardAt(r, c);
      if (!card) continue;
      const arr = m.get(card) ?? [];
      arr.push([r, c]);
      m.set(card, arr);
    }
  }
  return m;
})();

const DIRS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** All 5-cell windows on the board (rows, cols, both diagonals). */
export const WINDOWS: Array<Array<[number, number]>> = (() => {
  const out: Array<Array<[number, number]>> = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 4;
        const ec = c + dc * 4;
        if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;
        const cells: Array<[number, number]> = [];
        for (let i = 0; i < 5; i++) cells.push([r + dr * i, c + dc * i]);
        out.push(cells);
      }
    }
  }
  return out;
})();

/** windows indexed by cell "r,c" for fast lookup */
export const WINDOWS_BY_CELL: Map<string, Array<Array<[number, number]>>> = (() => {
  const m = new Map<string, Array<Array<[number, number]>>>();
  for (const w of WINDOWS) {
    for (const [r, c] of w) {
      const k = `${r},${c}`;
      const arr = m.get(k) ?? [];
      arr.push(w);
      m.set(k, arr);
    }
  }
  return m;
})();

export { DIRS };
