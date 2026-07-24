import type { CSSProperties } from 'react';
import type { Card } from '../../../shared/types';

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
      {suit === 'H' && (
        <path d="M12 21.6l-1.5-1.37C5.1 15.53 1.6 12.35 1.6 8.45 1.6 5.28 4.08 2.8 7.25 2.8c1.79 0 3.51.83 4.75 2.16C13.24 3.63 14.96 2.8 16.75 2.8c3.17 0 5.65 2.48 5.65 5.65 0 3.9-3.5 7.08-8.9 11.79L12 21.6z" />
      )}
      {suit === 'D' && <path d="M12 1.6 20.4 12 12 22.4 3.6 12z" />}
      {suit === 'S' && (
        <path d="M12 2.2C7.4 7.7 2.9 10.9 2.9 15.05a3.75 3.75 0 0 0 6.35 2.71c.02.02.02.02 0 .04-.28 2.5-1.28 4.3-2.85 5.7H17.6c-1.57-1.4-2.57-3.2-2.85-5.7-.02-.02-.02-.02 0-.04a3.75 3.75 0 0 0 6.35-2.71C21.1 10.9 16.6 7.7 12 2.2z" />
      )}
      {suit === 'C' && (
        <path d="M12 2.3a3.72 3.72 0 0 1 3.5 5.02 3.72 3.72 0 1 1 2.36 6.63c-.9 0-1.72-.32-2.36-.85.28 2.63 1.3 4.5 2.9 6.1H5.6c1.6-1.6 2.62-3.47 2.9-6.1-.64.53-1.46.85-2.36.85A3.72 3.72 0 1 1 8.5 7.32 3.72 3.72 0 0 1 12 2.3z" />
      )}
    </svg>
  );
}

/**
 * A clean, modern card face: a bold display-serif rank with a large suit over a
 * softly suit-tinted stock and a big watermark suit bleeding from the corner.
 * Reads instantly at board-cell size; richer with corner indices in the hand.
 * variant "cell" = mini card on the board, "hand" = full card in hand.
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
  const isJack = rank === 'J';
  const oneEyed = card === 'JS' || card === 'JH';

  return (
    <div className={`cardface v-${variant} suit-${suit} ${red ? 'red' : 'black'}`}>
      <SuitIcon suit={suit} className="cf-bg-suit" />

      <div className="cf-main">
        <span className="cf-main-rank">{label}</span>
        <SuitIcon suit={suit} className="cf-main-suit" />
      </div>

      {variant === 'hand' && (
        <>
          <span className="cf-idx tl">
            <b>{label}</b>
            <SuitIcon suit={suit} />
          </span>
          <span className="cf-idx br">
            <b>{label}</b>
            <SuitIcon suit={suit} />
          </span>
        </>
      )}

      {isJack && (
        <span className={`cf-jack-tag ${oneEyed ? 'cut' : 'wild'}`}>
          {oneEyed ? 'REMOVE' : 'WILD'}
        </span>
      )}
    </div>
  );
}
