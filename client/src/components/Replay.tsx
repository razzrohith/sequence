import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { isCorner } from '../../../shared/board';
import type { MoveEvent, Team } from '../../../shared/types';
import { useStore } from '../store';
import CardFace, { CornerEmblem, rankLabel } from './CardFace';

const SUIT_NAME: Record<string, string> = { H: 'hearts', D: 'diamonds', S: 'spades', C: 'clubs' };

/** Step-through replay of a finished local game, rebuilt from its full move log.
 * The board is reconstructed purely from place/remove events (no deck needed),
 * so it works entirely from what the local game already recorded. */
export default function Replay({ onClose }: { onClose: () => void }) {
  const core = useStore((s) => s.localCore);
  // only the board-changing events drive the timeline
  const moves = useMemo(
    () => (core?.log ?? []).filter((e) => e.kind === 'place' || e.kind === 'remove'),
    [core],
  );
  const [step, setStep] = useState(moves.length);
  const [playing, setPlaying] = useState(false);

  // auto-advance while playing; stop at the end
  useEffect(() => {
    if (!playing) return;
    if (step >= moves.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((k) => Math.min(k + 1, moves.length)), 650);
    return () => clearTimeout(t);
  }, [playing, step, moves.length]);

  // board occupancy + which cells belong to a completed sequence, after `step` moves
  const { chips, seqCells } = useMemo(() => {
    const chips = new Map<string, Team>();
    const seqCells = new Map<string, Team>();
    for (let i = 0; i < step; i++) {
      const e = moves[i];
      if (e.r == null || e.c == null) continue;
      if (e.kind === 'place') chips.set(`${e.r},${e.c}`, e.team);
      else chips.delete(`${e.r},${e.c}`);
      for (const seq of e.newSequences ?? []) {
        for (const [r, c] of seq.cells) seqCells.set(`${r},${c}`, seq.team);
      }
    }
    return { chips, seqCells };
  }, [moves, step]);

  if (!core) return null;
  const layout = core.layout;
  const last: MoveEvent | undefined = step > 0 ? moves[step - 1] : undefined;
  const caption = last
    ? `${last.playerName} ${last.kind === 'place' ? 'played' : 'removed'} ${
        last.card ? `${rankLabel(last.card)} of ${SUIT_NAME[last.card[1]] ?? ''}` : 'a chip'
      }${last.newSequences?.length ? ' — sequence!' : ''}`
    : 'Start of the game';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal replay"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2>Replay</h2>
        <div className="replay-caption">
          Move {step} / {moves.length} · {caption}
        </div>

        <div className="replay-board-wrap">
          <div className="board replay-board">
            {layout.map((row, r) =>
              row.map((code, c) => {
                const key = `${r}-${c}`;
                const corner = isCorner(r, c);
                const team = chips.get(`${r},${c}`);
                const seqTeam = seqCells.get(`${r},${c}`);
                const isLast = last && last.r === r && last.c === c;
                return (
                  <div key={key} className={`cell ${corner ? 'corner' : ''} ${isLast ? 'armed' : ''}`}>
                    {corner ? (
                      <div className="corner-blank">
                        <CornerEmblem />
                      </div>
                    ) : (
                      <CardFace card={code} variant="cell" />
                    )}
                    {team && (
                      <div className={`chip chip-${team} ${seqTeam === team ? 'chip-locked' : ''}`}>
                        <span className="chip-inner" />
                        {seqTeam === team && <span className="chip-star">★</span>}
                      </div>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>

        <input
          className="slider replay-slider"
          type="range"
          min={0}
          max={moves.length}
          value={step}
          onChange={(e) => {
            setPlaying(false);
            setStep(Number(e.target.value));
          }}
        />
        <div className="replay-controls">
          <button className="btn btn-ghost btn-sm" onClick={() => { setPlaying(false); setStep(0); }}>
            ⏮
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setPlaying(false); setStep((k) => Math.max(0, k - 1)); }}
          >
            ◀
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (step >= moves.length) setStep(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setPlaying(false); setStep((k) => Math.min(moves.length, k + 1)); }}
          >
            ▶
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setPlaying(false); setStep(moves.length); }}
          >
            ⏭
          </button>
        </div>
      </motion.div>
    </div>
  );
}
