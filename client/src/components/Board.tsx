import { AnimatePresence, motion } from 'framer-motion';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { isCorner } from '../../../shared/board';
import { isOneEyed, legalCellsOnBoard } from '../../../shared/game';
import type { Team } from '../../../shared/types';
import { useStore } from '../store';
import CardFace, { CornerEmblem, rankLabel } from './CardFace';

/** Distinct per-team symbol shown on chips in colorblind mode. */
const CB_GLYPH: Record<Team, string> = { red: '●', blue: '◆', green: '▲' };

const SUIT_NAME: Record<string, string> = {
  H: 'hearts',
  D: 'diamonds',
  S: 'spades',
  C: 'clubs',
};

/** Spoken description of a cell, for screen readers. */
function cellLabel(code: string, chip: Team | null, isLegal: boolean, removing: boolean): string {
  const card = `${rankLabel(code)} of ${SUIT_NAME[code[1]] ?? code[1]}`;
  const occupied = chip ? `, ${chip} chip` : ', empty';
  const action = isLegal ? (removing ? ', press to remove this chip' : ', press to play here') : '';
  return `${card}${occupied}${action}`;
}

function ChipRingText({ id }: { id: string }) {
  return (
    <svg className="chip-ring-text" viewBox="0 0 100 100" aria-hidden>
      <defs>
        <path
          id={id}
          d="M50,50 m-33,0 a33,33 0 1,1 66,0 a33,33 0 1,1 -66,0"
          fill="none"
        />
      </defs>
      <text>
        <textPath href={`#${id}`} startOffset="0">
          · SEQUENCE · SEQUENCE · SEQUENCE
        </textPath>
      </text>
    </svg>
  );
}

export default function Board() {
  const game = useStore((s) => s.game);
  const selectedCard = useStore((s) => s.selectedCard);
  const hint = useStore((s) => s.hint);
  const previewCard = useStore((s) => s.previewCard);
  const confirmPlace = useStore((s) => s.prefs.confirmPlace);
  // with 'confirm before placing' on, the first tap arms a cell, the second commits
  const [armed, setArmed] = useState<string | null>(null);
  // an armed cell belongs to one card on one turn; forget it the moment either
  // changes, otherwise the next tap would commit a different card unconfirmed
  useEffect(() => {
    setArmed(null);
  }, [selectedCard, game?.turn, game?.winner]);
  const playMove = useStore((s) => s.playMove);
  const selectCard = useStore((s) => s.selectCard);

  const me = game?.players.find((p) => p.id === game.yourId);
  const myTurn =
    !!game && !game.winner && !game.stalemate && game.players[game.turn]?.id === game.yourId;

  const legal = useMemo(() => {
    const card = selectedCard ?? previewCard;
    if (!game || !me || !card || !myTurn) return new Set<string>();
    return new Set(
      legalCellsOnBoard(game.board, me.team, card, game.layout).map(([r, c]) => `${r},${c}`),
    );
  }, [game, me, selectedCard, previewCard, myTurn]);

  const lastMove = game?.lastMove;
  const removing = selectedCard ? isOneEyed(selectedCard) : false;

  // cells belonging to completed sequences, for the gold glow
  const seqCells = useMemo(() => {
    const m = new Map<string, Team>();
    for (const s of game?.sequences ?? []) {
      for (const [r, c] of s.cells) m.set(`${r},${c}`, s.team);
    }
    return m;
  }, [game?.sequences]);

  // cells of the sequence just completed this move, for a one-shot shimmer sweep
  const justSeq = useMemo(() => {
    const s = new Set<string>();
    const lm = game?.lastMove;
    if (lm && lm.kind === 'place' && lm.newSequences?.length) {
      lm.newSequences.forEach((seq, si) =>
        seq.cells.forEach(([r, c], ci) => s.add(`${r},${c}:${si * 5 + ci}`)),
      );
    }
    return s;
  }, [game?.lastMove]);
  // index a cell into justSeq to get its sweep order (or -1)
  const sweepIndex = (r: number, c: number) => {
    for (const k of justSeq) if (k.startsWith(`${r},${c}:`)) return Number(k.split(':')[1]);
    return -1;
  };

  if (!game) return null;

  const onCellClick = (r: number, c: number) => {
    const key = `${r},${c}`;
    if (!selectedCard || !legal.has(key)) return;
    if (confirmPlace && armed !== key) {
      setArmed(key); // first tap only arms the cell
      return;
    }
    setArmed(null);
    if (removing) {
      playMove({ type: 'remove', card: selectedCard, r, c });
    } else {
      playMove({ type: 'place', card: selectedCard, r, c });
    }
    selectCard(null);
  };

  const lm = game.lastMove;
  const spoken = lm
    ? `${lm.playerName} ${
        lm.kind === 'place'
          ? `played ${rankLabel(lm.card ?? '')} of ${SUIT_NAME[(lm.card ?? '')[1]] ?? ''}`
          : lm.kind === 'remove'
            ? 'removed a chip'
            : lm.kind === 'pass'
              ? 'passed'
              : 'took a turn'
      }${lm.newSequences?.length ? '. Sequence completed' : ''}`
    : '';

  return (
    // .board-area is the measuring box: the board sizes itself from whatever
    // space is left over, so no layout needs a hardcoded chrome budget
    <div className="board-area">
      {/* announced to screen readers only, so opponents' moves are not silent */}
      <div className="sr-only" role="status" aria-live="polite">
        {spoken}
      </div>
    <div className={`board-frame ${myTurn ? 'your-turn' : ''} ${game.winner ? 'won' : ''}`}>
      <span className="bf-word left">SEQUENCE</span>
      <span className="bf-word right">SEQUENCE</span>
      <span className="bf-oval top">• TWO EYED JACKS ARE WILD •</span>
      <span className="bf-oval bottom">• ONE EYED JACKS REMOVE •</span>

      <div className={`board ${game.winner ? 'won' : ''}`}>
        {game.layout.map((row, r) =>
          row.map((code, c) => {
            const key = `${r}-${c}`;
            const corner = isCorner(r, c);
            const cell = game.board[r][c];
            const isLegal = legal.has(`${r},${c}`);
            const seqTeam = seqCells.get(`${r},${c}`);
            const sweep = sweepIndex(r, c);
            const isLast =
              lastMove && lastMove.r === r && lastMove.c === c && lastMove.kind === 'place';
            return (
              <div
                key={key}
                className={[
                  'cell',
                  corner ? 'corner' : '',
                  isLegal ? (removing ? 'legal-remove' : 'legal') : '',
                  seqTeam ? `in-seq seq-${seqTeam}` : '',
                  sweep >= 0 ? 'seq-flash' : '',
                  armed === `${r},${c}` ? 'armed' : '',
                ].join(' ')}
                style={sweep >= 0 ? ({ '--sweep': sweep } as CSSProperties) : undefined}
                onClick={() => onCellClick(r, c)}
                // keyboard play: only legal cells take focus, so Tab walks the
                // moves available for the selected card
                role={corner ? undefined : 'button'}
                tabIndex={isLegal ? 0 : -1}
                aria-disabled={corner ? undefined : !isLegal}
                aria-label={
                  corner ? 'Free corner space' : cellLabel(code, cell.chip, isLegal, removing)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onCellClick(r, c);
                  }
                }}
              >
                {corner ? (
                  <div className="corner-blank">
                    <CornerEmblem />
                  </div>
                ) : (
                  <CardFace card={code} variant="cell" />
                )}

                <AnimatePresence>
                  {cell.chip && (
                    <motion.div
                      key={`chip-${cell.chip}`}
                      className={`chip chip-${cell.chip} ${seqTeam === cell.chip ? 'chip-locked' : ''}`}
                      initial={{ scale: 2.2, opacity: 0, y: -26 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.3, opacity: 0, rotate: 120, y: 20 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    >
                      <ChipRingText id={`cring-${r}-${c}`} />
                      <span className="chip-inner" />
                      <span className="chip-cb">{CB_GLYPH[cell.chip]}</span>
                      {seqTeam === cell.chip && <span className="chip-star">★</span>}
                    </motion.div>
                  )}
                </AnimatePresence>

                {isLast && <div className="last-ring" />}
                {hint && hint.turn === game.turn && hint.r === r && hint.c === c && (
                  <div className="hint-mark">✦</div>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
    </div>
  );
}
