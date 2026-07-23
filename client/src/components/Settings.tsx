import { motion } from 'framer-motion';
import { AVATARS, useStore } from '../store';
import { sfx } from '../sounds';

function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="setting-row">
      <span>
        <b>{label}</b>
        {hint && <i>{hint}</i>}
      </span>
      <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
        <span className="knob" />
      </button>
    </label>
  );
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal settings"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2>Settings</h2>

        <div className="setting-group">
          <span className="setting-label">Your avatar</span>
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button
                key={a}
                className={`avatar-opt ${prefs.avatar === a ? 'on' : ''}`}
                onClick={() => {
                  sfx.select();
                  setPref('avatar', a);
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <Toggle on={prefs.sound} onChange={(v) => setPref('sound', v)} label="Sound effects" />
        <Toggle
          on={prefs.haptics}
          onChange={(v) => setPref('haptics', v)}
          label="Vibration"
          hint="haptic feedback on supported phones"
        />
        <Toggle
          on={prefs.colorblind}
          onChange={(v) => setPref('colorblind', v)}
          label="Colorblind mode"
          hint="adds a distinct symbol to each team's chips"
        />

        <div className="setting-group">
          <span className="setting-label">AI difficulty (solo &amp; quick play)</span>
          <div className="seg">
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <button
                key={d}
                className={`seg-btn ${prefs.difficulty === d ? 'on' : ''}`}
                onClick={() => setPref('difficulty', d)}
              >
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
