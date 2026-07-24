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

/** Crisp SVG suit symbols (font glyphs render inconsistently at small sizes) */
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
        <path d="M12 21.5C5.4 15.2 2.5 11.4 2.5 7.9 2.5 5.2 4.7 3 7.4 3c1.8 0 3.5 1 4.6 2.6C13.1 4 14.8 3 16.6 3c2.7 0 4.9 2.2 4.9 4.9 0 3.5-2.9 7.3-9.5 13.6z" />
      )}
      {suit === 'D' && <path d="M12 1.5 19.3 12 12 22.5 4.7 12z" />}
      {suit === 'S' && (
        <path d="M12 1.5C6.8 7.2 3.2 10.4 3.2 14a4.4 4.4 0 0 0 7.6 3c-.1 2-.9 3.6-2.4 5.5h7.2c-1.5-1.9-2.3-3.5-2.4-5.5a4.4 4.4 0 0 0 7.6-3c0-3.6-3.6-6.8-8.8-12.5z" />
      )}
      {suit === 'C' && (
        <>
          <circle cx="12" cy="6.8" r="4.4" />
          <circle cx="6.2" cy="13.8" r="4.4" />
          <circle cx="17.8" cy="13.8" r="4.4" />
          <path d="M10.6 14.5h2.8c-.2 3 .7 5.4 2.2 7.5H8.4c1.5-2.1 2.4-4.5 2.2-7.5z" />
        </>
      )}
    </svg>
  );
}

/** Standard playing-card pip positions as [x%, y%] */
const PIP_LAYOUT: Record<string, Array<[number, number]>> = {
  '2': [
    [50, 20],
    [50, 80],
  ],
  '3': [
    [50, 20],
    [50, 50],
    [50, 80],
  ],
  '4': [
    [30, 20],
    [70, 20],
    [30, 80],
    [70, 80],
  ],
  '5': [
    [30, 20],
    [70, 20],
    [50, 50],
    [30, 80],
    [70, 80],
  ],
  '6': [
    [30, 20],
    [70, 20],
    [30, 50],
    [70, 50],
    [30, 80],
    [70, 80],
  ],
  '7': [
    [30, 20],
    [70, 20],
    [50, 34],
    [30, 50],
    [70, 50],
    [30, 80],
    [70, 80],
  ],
  '8': [
    [30, 20],
    [70, 20],
    [50, 34],
    [30, 50],
    [70, 50],
    [50, 66],
    [30, 80],
    [70, 80],
  ],
  '9': [
    [30, 18],
    [70, 18],
    [30, 39],
    [70, 39],
    [50, 50],
    [30, 61],
    [70, 61],
    [30, 82],
    [70, 82],
  ],
  T: [
    [30, 18],
    [70, 18],
    [50, 29],
    [30, 39],
    [70, 39],
    [30, 61],
    [70, 61],
    [50, 71],
    [30, 82],
    [70, 82],
  ],
};

/**
 * A realistic playing-card face: proper pip patterns for number cards,
 * framed "artwork" for court cards, big center pip for aces.
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
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  const oneEyed = card === 'JS' || card === 'JH';

  return (
    <div className={`cardface v-${variant} ${red ? 'red' : 'black'}`}>
      <div className="cf-corner tl">
        <span className="cf-rank">{label}</span>
        <SuitIcon suit={suit} className="cf-suit" />
      </div>

      {rank === 'A' ? (
        <div className="cf-center">
          <SuitIcon suit={suit} className="cf-ace" />
        </div>
      ) : court ? (
        <div className="cf-center">
          <div className="cf-court">
            <span className="cf-court-letter">{label}</span>
            <SuitIcon suit={suit} className="cf-court-suit" />
            {rank === 'J' && (
              <span className={`cf-jack-tag ${oneEyed ? 'cut' : 'wild'}`}>
                {oneEyed ? '⊘' : '★'}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="cf-pips">
          {(PIP_LAYOUT[rank] ?? []).map(([x, y], i) => (
            <SuitIcon
              key={i}
              suit={suit}
              className={`pip ${y > 50 ? 'flip' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            />
          ))}
        </div>
      )}

      <div className="cf-corner br">
        <span className="cf-rank">{label}</span>
        <SuitIcon suit={suit} className="cf-suit" />
      </div>
    </div>
  );
}
