import { motion } from 'framer-motion';
import { useState } from 'react';
import { useStore, type LocalSeat } from '../store';

const COUNTS = [2, 3, 4, 6];

export default function LocalSetup({ onClose }: { onClose: () => void }) {
  const myName = useStore((s) => s.name);
  const startLocal = useStore((s) => s.startLocal);
  const [seats, setSeats] = useState<LocalSeat[]>([
    { name: myName || 'Player 1', isBot: false },
    { name: '', isBot: false },
  ]);

  const setCount = (n: number) => {
    setSeats((prev) => {
      const next = [...prev];
      while (next.length < n) next.push({ name: '', isBot: true });
      return next.slice(0, n);
    });
  };

  const humans = seats.filter((s) => !s.isBot).length;
  const teams = seats.length === 3 ? '3 colors, 1 sequence wins' : '2 teams, 2 sequences win';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal local-setup"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2>Pass &amp; Play</h2>
        <p className="ls-sub">
          Everyone shares this device — hands stay hidden with a pass-the-device screen between
          turns. {teams}.
        </p>

        <div className="seg ls-count">
          <span className="seg-label">Players</span>
          {COUNTS.map((n) => (
            <button
              key={n}
              className={`seg-btn ${seats.length === n ? 'on' : ''}`}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="ls-seats">
          {seats.map((seat, i) => (
            <div key={i} className="ls-seat">
              <span className={`team-dot ${['red', 'blue', 'green'][i % (seats.length === 3 ? 3 : 2)]}`} />
              <button
                className={`ls-kind ${seat.isBot ? 'bot' : 'human'}`}
                onClick={() =>
                  setSeats((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, isBot: !p.isBot } : p)),
                  )
                }
              >
                {seat.isBot ? '🤖 Bot' : '🙂 Human'}
              </button>
              {seat.isBot ? (
                <span className="ls-botname">plays automatically</span>
              ) : (
                <input
                  value={seat.name}
                  maxLength={16}
                  placeholder={`Player ${i + 1}`}
                  onChange={(e) =>
                    setSeats((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>

        <motion.button
          className="btn btn-primary btn-big"
          disabled={humans < 1}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            startLocal(seats);
            onClose();
          }}
        >
          Deal the cards ▸
        </motion.button>
        {humans < 1 && <p className="hint">At least one human player is needed.</p>}
      </motion.div>
    </div>
  );
}
