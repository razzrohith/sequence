import { motion } from 'framer-motion';
import { useState } from 'react';
import type { GameSettings } from '../../../shared/types';
import { useStore, type LocalSeat } from '../store';

const COUNTS = [2, 3, 4, 6];

/** House-rules presets: each bundles a few settings over the classic game. */
const PRESETS: { id: string; label: string; note: string; settings: Partial<GameSettings> }[] = [
  { id: 'classic', label: 'Classic', note: 'The standard game.', settings: {} },
  {
    id: 'blitz',
    label: '⚡ Blitz',
    note: '20-second turns and jacks come early. Fast and frantic.',
    settings: { turnSeconds: 20, powerCards: true },
  },
  {
    id: 'marathon',
    label: '🏔 Marathon',
    note: 'Three sequences to win. A long, strategic game.',
    settings: { winSequences: 3 },
  },
  {
    id: 'purist',
    label: '🎩 Purist',
    note: 'No swapping dead cards. Play the hand you are dealt.',
    settings: { allowDeadExchange: false },
  },
  {
    id: 'wild',
    label: '🎲 Wildcard',
    note: 'Shuffled board and early jacks. A fresh layout every time.',
    settings: { randomBoard: true, powerCards: true },
  },
];

const MATCHES: [number, string][] = [
  [1, 'Single'],
  [2, 'Best of 3'],
  [3, 'Best of 5'],
];

export default function LocalSetup({ onClose }: { onClose: () => void }) {
  const myName = useStore((s) => s.name);
  const startLocal = useStore((s) => s.startLocal);
  const [seats, setSeats] = useState<LocalSeat[]>([
    { name: myName || 'Player 1', isBot: false },
    { name: '', isBot: false },
  ]);
  const [preset, setPreset] = useState('classic');
  const [match, setMatch] = useState(1);
  const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];

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
          Everyone shares this device. Hands stay hidden with a pass-the-device screen between
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

        <div className="ls-rules">
          <span className="seg-label">House rules</span>
          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset-btn ${preset === p.id ? 'on' : ''}`}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="preset-note">{chosen.note}</p>
        </div>

        <div className="seg ls-match">
          <span className="seg-label">Match</span>
          {MATCHES.map(([v, lbl]) => (
            <button
              key={v}
              className={`seg-btn ${match === v ? 'on' : ''}`}
              onClick={() => setMatch(v)}
            >
              {lbl}
            </button>
          ))}
        </div>

        <motion.button
          className="btn btn-primary btn-big"
          disabled={humans < 1}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            startLocal(seats, { settings: chosen.settings, series: match });
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
