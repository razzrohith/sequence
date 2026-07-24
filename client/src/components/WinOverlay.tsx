import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { Team } from '../../../shared/types';
import { useStore } from '../store';

const TEAM_LABEL: Record<Team, string> = { red: 'RED', blue: 'BLUE', green: 'GREEN' };
const TEAM_HEX: Record<Team, string> = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e' };

/** Post-game recap: chips placed and sequences by team. */
function Recap() {
  const game = useStore((s) => s.game);
  if (!game) return null;
  const teams = [...new Set(game.players.map((p) => p.team))] as Team[];
  const chipsOnBoard = (t: Team) =>
    game.board.flat().filter((c) => c.chip === t).length;
  const seqs = (t: Team) => game.sequences.filter((s) => s.team === t).length;
  // NB: game.log is truncated to the last 20 events, so it can't be counted for
  // a whole-game total, read the board instead, which is always complete.
  const chipsPlaced = game.board.flat().filter((c) => c.chip).length;

  return (
    <div className="recap">
      <div className="recap-title">Recap</div>
      <div className="recap-teams">
        {teams.map((t) => (
          <div key={t} className="recap-team">
            <span className={`team-dot ${t}`} />
            <span className="recap-name">{t[0].toUpperCase() + t.slice(1)}</span>
            <span className="recap-stat">{seqs(t)} seq</span>
            <span className="recap-stat">{chipsOnBoard(t)} chips</span>
          </div>
        ))}
      </div>
      <div className="recap-foot">{chipsPlaced} chips on the board</div>
    </div>
  );
}

function Confetti({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = [color, '#fbbf24', '#ffffff', '#a78bfa', color];
    const parts = Array.from({ length: 180 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3.5,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: -0.1 + Math.random() * 0.2,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.y += p.vy;
        p.x += p.vx + Math.sin(p.y / 40);
        p.rot += p.vr;
        if (p.y > canvas.height + 20) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [color]);

  return <canvas ref={ref} className="confetti" />;
}

export default function WinOverlay() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const mode = useStore((s) => s.mode);
  const playerId = useStore((s) => s.playerId);
  const rematch = useStore((s) => s.rematch);
  const leaveRoom = useStore((s) => s.leaveRoom);

  if (!game?.winner && !game?.stalemate) return null;
  const winner = game.winner;
  const myTeam = game.players.find((p) => p.id === game.yourId)?.team;
  const won = winner !== null && myTeam === winner;
  const isHost = mode === 'local' || room?.hostId === playerId;
  const chipsSummary = [...new Set(game.players.map((p) => p.team))]
    .map(
      (t) =>
        `${t}: ${game.sequences.filter((s) => s.team === t).length} seq`,
    )
    .join(', ');

  return (
    <div className="win-overlay">
      {winner && <Confetti color={TEAM_HEX[winner]} />}
      <motion.div
        className="win-card"
        initial={{ scale: 0.6, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 15, delay: 0.15 }}
      >
        <motion.div
          className="win-chip"
          style={{ background: winner ? TEAM_HEX[winner] : '#6b7280' }}
          animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.08, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          ★
        </motion.div>
        <h1 style={{ color: winner ? TEAM_HEX[winner] : '#9ca3af' }}>
          {winner ? `${TEAM_LABEL[winner]} WINS!` : "IT'S A DRAW"}
        </h1>
        <p className="win-sub">
          {winner
            ? won
              ? 'Brilliant! Your team completed the sequences. 🏆'
              : 'So close! Run it back?'
            : 'Every hand is empty. Nobody can move. Rare!'}
        </p>

        <Recap />

        <button
          className="btn btn-ghost"
          onClick={async () => {
            const text = winner
              ? `${TEAM_LABEL[winner]} won our game of Sequence! ${chipsSummary}`
              : `Our game of Sequence ended in a draw. ${chipsSummary}`;
            try {
              if (navigator.share) await navigator.share({ text });
              else await navigator.clipboard.writeText(text);
            } catch {
              /* user dismissed the share sheet */
            }
          }}
        >
          ⤴ Share result
        </button>

        <div className="win-actions">
          {isHost ? (
            <motion.button
              className="btn btn-primary btn-big"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={rematch}
            >
              ↻ Rematch
            </motion.button>
          ) : (
            <span className="waiting">Waiting for the host to start a rematch…</span>
          )}
          <button className="btn btn-ghost" onClick={leaveRoom}>
            Leave table
          </button>
        </div>
      </motion.div>
    </div>
  );
}
