import { motion } from 'framer-motion';
import type { Team } from '../../../shared/types';
import { useStore } from '../store';

const TEAM_LABEL: Record<Team, string> = { red: 'Red', blue: 'Blue', green: 'Green' };

export default function PlayersPanel() {
  const game = useStore((s) => s.game);
  if (!game) return null;

  const teams = [...new Set(game.players.map((p) => p.team))];
  const seqCount = (t: Team) => game.sequences.filter((s) => s.team === t).length;

  return (
    <div className="panel players-panel">
      <div className="panel-title">Teams: first to {game.required} sequence{game.required > 1 ? 's' : ''}</div>

      <div className="team-scores">
        {teams.map((t) => (
          <div key={t} className={`team-score team-${t}`}>
            <span className={`team-dot ${t}`} />
            <span className="ts-name">{TEAM_LABEL[t]}</span>
            <span className="ts-pips">
              {Array.from({ length: game.required }).map((_, i) => (
                <span key={i} className={`pip ${i < seqCount(t) ? 'filled' : ''}`} />
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="panel-title">Players</div>
      <div className="game-players">
        {game.players.map((p, i) => {
          const isTurn = i === game.turn && !game.winner;
          return (
            <motion.div
              key={p.id}
              className={`gp-row ${isTurn ? 'turn' : ''}`}
              animate={isTurn ? { scale: [1, 1.02, 1] } : { scale: 1 }}
              transition={isTurn ? { repeat: Infinity, duration: 1.6 } : {}}
            >
              <span className={`team-dot ${p.team}`} />
              {p.avatar && <span className="gp-avatar">{p.avatar}</span>}
              <span className="gp-name">
                {p.name}
                {p.id === game.yourId && <span className="badge you">YOU</span>}
                {p.isBot && <span className="badge bot">AI</span>}
                {!p.connected && !p.isBot && <span className="badge off">OFFLINE</span>}
              </span>
              <span className="gp-cards" title={`${p.handCount} cards`}>
                🂠 {p.handCount}
              </span>
              {isTurn && <span className="turn-arrow">▶</span>}
            </motion.div>
          );
        })}
      </div>

      <div className="panel-title">Recent moves</div>
      <div className="move-log">
        {[...game.log]
          .filter((e) => e.kind !== 'draw')
          .slice(-6)
          .reverse()
          .map((e) => (
            <div key={e.n} className="log-row">
              <span className={`team-dot ${e.team}`} />
              <span>
                {e.playerName}{' '}
                {e.kind === 'place' && `played ${pretty(e.card)}`}
                {e.kind === 'remove' && `removed a chip (${pretty(e.card)})`}
                {e.kind === 'exchangeDead' && 'exchanged a dead card'}
                {e.kind === 'pass' && 'passed'}
                {e.kind === 'forfeitDraw' && 'forfeited a draw!'}
                {e.newSequences && e.newSequences.length > 0 && ' SEQUENCE!'}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
function pretty(card?: string) {
  if (!card) return '';
  const r = card[0] === 'T' ? '10' : card[0];
  return `${r}${SUIT_GLYPH[card[1]] ?? ''}`;
}
