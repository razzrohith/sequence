import type { CSSProperties } from 'react';
import type { Card } from '../../../shared/types';
import { COURT_ART } from '../assets/courts';

const RANK_LABEL: Record<string, string> = { T: '10', A: 'A', J: 'J', Q: 'Q', K: 'K' };

export function suitOf(card: Card): string {
  return card[1];
}
export function rankLabel(card: Card): string {
  const r = card[0];
  return RANK_LABEL[r] ?? r;
}
export function isRedSuit(card: Card): boolean {
  return card[1] === 'H' || card[1] === 'D';
}

/** Unified suit shapes (24×24), clean at any size. */
export const SUIT_PATH: Record<string, string> = {
  H: 'M12 21.6l-1.5-1.37C5.1 15.53 1.6 12.35 1.6 8.45 1.6 5.28 4.08 2.8 7.25 2.8c1.79 0 3.51.83 4.75 2.16C13.24 3.63 14.96 2.8 16.75 2.8c3.17 0 5.65 2.48 5.65 5.65 0 3.9-3.5 7.08-8.9 11.79L12 21.6z',
  D: 'M12 1.6 20.4 12 12 22.4 3.6 12z',
  S: 'M12 2.2C7.4 7.7 2.9 10.9 2.9 15.05a3.75 3.75 0 0 0 6.35 2.71c.02.02.02.02 0 .04-.28 2.5-1.28 4.3-2.85 5.7H17.6c-1.57-1.4-2.57-3.2-2.85-5.7-.02-.02-.02-.02 0-.04a3.75 3.75 0 0 0 6.35-2.71C21.1 10.9 16.6 7.7 12 2.2z',
  C: 'M12 2.3a3.72 3.72 0 0 1 3.5 5.02 3.72 3.72 0 1 1 2.36 6.63c-.9 0-1.72-.32-2.36-.85.28 2.63 1.3 4.5 2.9 6.1H5.6c1.6-1.6 2.62-3.47 2.9-6.1-.64.53-1.46.85-2.36.85A3.72 3.72 0 1 1 8.5 7.32 3.72 3.72 0 0 1 12 2.3z',
};

/** Crisp, classic SVG suit symbols (unified shapes — clean at any size). */
export function SuitIcon({
  suit,
  className,
  style,
}: {
  suit: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" className={`suit-icon ${className ?? ''}`} style={style} aria-hidden>
      <path d={SUIT_PATH[suit]} />
    </svg>
  );
}

/** A jester's cap with three belled points — the "joker" motif for wild/remove jacks. */
export function JesterCap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 24" className={`jester ${className ?? ''}`} aria-hidden>
      <path d="M16 5C10 5 6 8.5 5.6 13.2L4.2 9.2C3.8 8 2.4 7.6 1.7 8.6 1.1 9.4 1.6 10.4 2.5 10.7L7.2 12.4C7 13 6.9 13.6 6.9 14.2L25.1 14.2C25.1 13.6 25 13 24.8 12.4L29.5 10.7C30.4 10.4 30.9 9.4 30.3 8.6 29.6 7.6 28.2 8 27.8 9.2L26.4 13.2C26 8.5 22 5 16 5Z" />
      <path d="M13 4.4C13 2.6 19 2.6 19 4.4L18 6C17 5.4 15 5.4 14 6Z" />
      <circle cx="16" cy="2.6" r="2.1" />
      <circle cx="1.9" cy="8.7" r="1.9" />
      <circle cx="30.1" cy="8.7" r="1.9" />
      <path d="M6.9 14.2L25.1 14.2 23.5 17 20.5 15 18.5 17.5 16 15 13.5 17.5 11.5 15 8.5 17Z" />
    </svg>
  );
}

/** Ornate 4-suit medallion for the board's corner free-spaces (free for every team). */
export function CornerEmblem() {
  const ink = '#33291d';
  const dots = Array.from({ length: 36 }).map((_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return <circle key={i} cx={50 + Math.cos(a) * 41.7} cy={50 + Math.sin(a) * 41.7} r={0.9} fill={ink} />;
  });
  const glyph = (suit: string, cx: number, cy: number, s = 1.05) => (
    <path
      transform={`translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})`}
      d={SUIT_PATH[suit]}
      fill={ink}
    />
  );
  return (
    <svg viewBox="0 0 100 100" className="corner-emblem" aria-hidden>
      <circle cx="50" cy="50" r="45" fill="none" stroke={ink} strokeWidth="2.4" />
      <circle cx="50" cy="50" r="38.5" fill="none" stroke={ink} strokeWidth="1" />
      {dots}
      {glyph('H', 50, 26)}
      {glyph('D', 74, 50)}
      {glyph('S', 50, 74)}
      {glyph('C', 26, 50)}
      <circle cx="50" cy="50" r="6.5" fill="none" stroke={ink} strokeWidth="1.4" />
      <circle cx="50" cy="50" r="2.2" fill={ink} />
    </svg>
  );
}

/**
 * Card faces come in two looks:
 *  - variant "hand" — "Color Pop": a bold sans rank in the suit colour with a
 *    corner wedge; jacks flag their WILD / REMOVE power.
 *  - variant "cell" — the board: an aged-paper vintage deck. Queens and Kings
 *    show real single-figure 1800s court illustrations; number cards use a bold
 *    serif rank over the suit. Every card carries big, legible corner indices.
 */
export default function CardFace({
  card,
  variant = 'hand',
}: {
  card: Card;
  variant?: 'cell' | 'hand';
}) {
  const suit = suitOf(card);
  const rank = card[0];
  const label = rankLabel(card);
  const red = isRedSuit(card);

  // ----- Board: vintage aged-paper card -----
  if (variant === 'cell') {
    const isCourt = rank === 'Q' || rank === 'K';
    const isAce = rank === 'A';
    const cx = isCourt ? 'cf-cx badge' : 'cf-cx';
    return (
      <div className={`cardface v-cell suit-${suit} ${red ? 'red' : 'black'}`}>
        {isCourt ? (
          <div className="cf-court" style={{ backgroundImage: `url(${COURT_ART[card]})` }} />
        ) : isAce ? (
          <SuitIcon suit={suit} className="cf-ace" />
        ) : (
          <>
            <SuitIcon suit={suit} className="cf-wm" />
            <div className="cf-mid">
              <span className="cf-mid-rank">{label}</span>
              <SuitIcon suit={suit} className="cf-mid-suit" />
            </div>
          </>
        )}
        <div className="cf-frame" />
        <span className={`${cx} tl`}>
          <span className="cf-cx-rk">{label}</span>
          <SuitIcon suit={suit} />
        </span>
        <span className={`${cx} br`}>
          <span className="cf-cx-rk">{label}</span>
          <SuitIcon suit={suit} />
        </span>
      </div>
    );
  }

  // ----- Hand: Color Pop -----
  const isJack = rank === 'J';
  const oneEyed = card === 'JS' || card === 'JH';
  return (
    <div className={`cardface v-hand ${isJack ? 'is-jack' : ''} suit-${suit} ${red ? 'red' : 'black'}`}>
      <div className="cf-wedge" />
      <span className="cf-pop-tl">{label}</span>
      {isJack ? (
        <div className="cf-pop-main cf-jack-main">
          <JesterCap />
        </div>
      ) : (
        <div className="cf-pop-main">
          <span className="cf-pop-rank">{label}</span>
          <SuitIcon suit={suit} className="cf-pop-suit" />
        </div>
      )}
      {isJack && (
        <span className={`cf-jack-tag ${oneEyed ? 'cut' : 'wild'}`}>
          <span className="jt-eye">{oneEyed ? 'ONE-EYED' : 'TWO-EYED'}</span>
          <span className="jt-pow">{oneEyed ? 'REMOVE' : 'WILD'}</span>
        </span>
      )}
    </div>
  );
}
