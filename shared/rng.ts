// Seedable RNG + short shareable seed codes.
//
// A "seed" is a short human-friendly code (e.g. "K7QP2"). The same seed always
// produces the same deal — deck order, board layout, first player, and any
// mid-game reshuffle — so two people can play the identical setup, and a game
// can be replayed or shared. (Bot decisions are not part of the seed; the seed
// fixes the cards and board, which is what makes a shared game fair.)

/** Fast, well-distributed 32-bit PRNG. Same seed -> same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an arbitrary seed code to a uint32 (FNV-1a), so any string seeds an rng. */
export function hashSeed(code: string): number {
  let h = 0x811c9dc5;
  const s = code.trim().toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** An rng driven by a seed code. */
export function seededRng(code: string): () => number {
  return mulberry32(hashSeed(code));
}

// Crockford-ish base32 without vowels/ambiguous chars, so codes are easy to read
// aloud and retype (no O/0, I/1, etc.).
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A fresh random 5-character seed code, e.g. "K7QP2". */
export function makeSeed(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

/** Normalize user-typed seeds (uppercase, trim, keep only code chars). */
export function cleanSeed(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 12);
}

/** The deterministic seed for a given calendar day, e.g. "DLY-20260801".
 * Everyone playing that day's challenge gets the identical deal. */
export function dailySeed(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `DLY-${y}${m}${d}`;
}
