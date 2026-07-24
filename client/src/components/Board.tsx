import { AnimatePresence, motion } from 'framer-motion';
import { type CSSProperties, useMemo } from 'react';
import { BOARD_LAYOUT, isCorner } from '../../../shared/board';
import { isOneEyed, legalCellsOnBoard } from '../../../shared/game';
import type { Team } from '../../../shared/types';
import { useStore } from '../store';
import CardFace, { CornerEmblem } from './CardFace';

/** Distinct per-team symbol shown on chips in colorblind mode. */
const CB_GLYPH: Record<Team, string> = { red: '●', blue: '◆', green: '▲' };

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
  const playMove = useStore((s) => s.playMove);
  const selectCard = useStore((s) => s.selectCard);

  const me = game?.players.find((p) => p.id === game.yourId);
  const myTurn =
    !!game && !game.winner && !game.stalemate && game.players[game.turn]?.id === game.yourId;

  const legal = useMemo(() => {
    if (!game || !me || !selectedCard || !myTurn) return new Set<string>();
    return new Set(
      legalCellsOnBoard(game.board, me.team, selectedCard).map(([r, c]) => `${r},${c}`),
    );
  }, [game, me, selectedCard, myTurn]);

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

  // cells of the sequence just completed this move — for a one-shot shimmer sweep
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
    if (!selectedCard || !legal.has(`${r},${c}`)) return;
    if (removing) {
      playMove({ type: 'remove', card: selectedCard, r, c });
    } else {
      playMove({ type: 'place', card: selectedCard, r, c });
    }
    selectCard(null);
  };

  return (
    <div className={`board-frame ${myTurn ? 'your-turn' : ''} ${game.winner ? 'won' : ''}`}>
      <span className="bf-word left">SEQUENCE</span>
      <span className="bf-word right">SEQUENCE</span>
      <span className="bf-oval top">• TWO EYED JACKS ARE WILD •</span>
      <span className="bf-oval bottom">• ONE EYED JACKS REMOVE •</span>

      <div className={`board ${game.winner ? 'won' : ''}`}>
        {BOARD_LAYOUT.map((row, r) =>
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
                ].join(' ')}
                style={sweep >= 0 ? ({ '--sweep': sweep } as CSSProperties) : undefined}
                onClick={() => onCellClick(r, c)}
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
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
