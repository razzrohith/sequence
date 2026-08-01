import { motion } from 'framer-motion';
import { ACHIEVEMENTS, levelForXp, useStore, xpForStats } from '../store';

/** Progression: level + XP, lifetime stats, and the achievement wall. */
export default function Progress({ onClose }: { onClose: () => void }) {
  const stats = useStore((s) => s.stats);
  const achievements = useStore((s) => s.achievements);

  const xp = xpForStats(stats, achievements);
  const { level, into, span } = levelForXp(xp);
  const winRate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
  const pct = Math.min(100, Math.round((into / span) * 100));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal progress-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2>Your progress</h2>

        <div className="level-row">
          <div className="level-badge">
            <span className="level-num">{level}</span>
            <span className="level-word">LEVEL</span>
          </div>
          <div className="level-bar-wrap">
            <div className="level-bar">
              <div className="level-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="level-xp">
              {into} / {span} XP to level {level + 1}
            </span>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-cell">
            <b>{stats.games}</b>
            <span>Games</span>
          </div>
          <div className="stat-cell">
            <b>{stats.wins}</b>
            <span>Wins</span>
          </div>
          <div className="stat-cell">
            <b>{winRate}%</b>
            <span>Win rate</span>
          </div>
          <div className="stat-cell">
            <b>{stats.streak}</b>
            <span>Streak</span>
          </div>
          <div className="stat-cell">
            <b>{stats.bestStreak}</b>
            <span>Best streak</span>
          </div>
          <div className="stat-cell">
            <b>
              {achievements.length}/{ACHIEVEMENTS.length}
            </b>
            <span>Badges</span>
          </div>
        </div>

        <div className="ach-title">Achievements</div>
        <div className="ach-grid">
          {ACHIEVEMENTS.map((a) => {
            const got = achievements.includes(a.id);
            return (
              <div key={a.id} className={`ach-card ${got ? 'got' : 'locked'}`} title={a.desc}>
                <span className="ach-emoji">{got ? a.emoji : '🔒'}</span>
                <span className="ach-label">{a.label}</span>
                <span className="ach-desc">{a.desc}</span>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
