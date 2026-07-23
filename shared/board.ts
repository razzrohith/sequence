import type { Card } from './types';

/** 'XX' marks the four free corners. T = 10. Canonical Sequence board layout. */
export const BOARD_LAYOUT: string[][] = [
  ['XX', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', 'XX'],
  ['6C', '5C', '4C', '3C', '2C', 'AH', 'KH', 'QH', 'TH', 'TS'],
  ['7C', 'AS', '2D', '3D', '4D', '5D', '6D', '7D', '9H', 'QS'],
  ['8C', 'KS', '6C', '5C', '4C', '3C', '2C', '8D', '8H', 'KS'],
  ['9C', 'QS', '7C', '6H', '5H', '4H', 'AH', '9D', '7H', 'AS'],
  ['TC', 'TS', '8C', '7H', '2H', '3H', 'KH', 'TD', '6H', '2D'],
  ['QC', '9S', '9C', '8H', '9H', 'TH', 'QH', 'QD', '5H', '3D'],
  ['KC', '8S', 'TC', 'QC', 'KC', 'AC', 'AD', 'KD', '4H', '4D'],
  ['AC', '7S', '6S', '5S', '4S', '3S', '2S', '2H', '3H', '5D'],
  ['XX', 'AD', 'KD', 'QD', 'TD', '9D', '8D', '7D', '6D', 'XX'],
];

export const SIZE = 10;

export function isCorner(r: number, c: number): boolean {
  return (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1);
}

export function cardAt(r: number, c: number): Card | null {
  const v = BOARD_LAYOUT[r][c];
  return v === 'XX' ? null : v;
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
