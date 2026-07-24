import { motion } from 'framer-motion';
import { AVATARS, BOARD_THEMES, CARD_BACKS, CHIP_STYLES, useStore } from '../store';
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
  const toast = useStore((s) => s.toast);

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

        <div className="setting-group">
          <span className="setting-label">Board theme</span>
          <div className="theme-grid">
            {BOARD_THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-opt ${prefs.boardTheme === t.id ? 'on' : ''}`}
                data-board={t.id}
                onClick={() => {
                  sfx.select();
                  setPref('boardTheme', t.id);
                }}
              >
                <span className="theme-swatch" />
                <span className="theme-name">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Toggle on={prefs.sound} onChange={(v) => setPref('sound', v)} label="Sound effects" />
        {prefs.sound && (
          <label className="setting-row">
            <span>
              <b>Volume</b>
              <i>{Math.round((prefs.volume ?? 0.8) * 100)}%</i>
            </span>
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              value={Math.round((prefs.volume ?? 0.8) * 100)}
              onChange={(e) => setPref('volume', Number(e.target.value) / 100)}
            />
          </label>
        )}
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
        <Toggle
          on={prefs.reducedMotion}
          onChange={(v) => setPref('reducedMotion', v)}
          label="Reduce motion"
          hint="minimizes animations and effects"
        />
        <Toggle
          on={prefs.highContrast}
          onChange={(v) => setPref('highContrast', v)}
          label="High contrast"
          hint="bolder outlines and text for readability"
        />

        <div className="setting-group">
          <span className="setting-label">Keep my hand sorted</span>
          <div className="seg">
            {(
              [
                ['off', 'Off'],
                ['suit', 'By suit'],
                ['rank', 'By rank'],
              ] as const
            ).map(([v, lbl]) => (
              <button
                key={v}
                className={`seg-btn ${(prefs.sortHand ?? 'off') === v ? 'on' : ''}`}
                onClick={() => setPref('sortHand', v)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <Toggle
          on={prefs.confirmPlace}
          onChange={(v) => setPref('confirmPlace', v)}
          label="Confirm before placing"
          hint="tap a space twice, so a mis-tap never burns a card"
        />
        <Toggle
          on={prefs.leftHanded}
          onChange={(v) => setPref('leftHanded', v)}
          label="Left-handed layout"
          hint="mirrors the hand and toolbar"
        />
        <Toggle
          on={prefs.notifyTurn}
          onChange={async (v) => {
            // only store it once the browser has actually granted permission,
            // and say so when it refuses instead of silently snapping back
            if (v) {
              if (typeof Notification === 'undefined') {
                toast('This browser cannot show notifications.', 'error');
                return;
              }
              const perm =
                Notification.permission === 'granted'
                  ? 'granted'
                  : await Notification.requestPermission();
              if (perm !== 'granted') {
                toast(
                  'Notifications are blocked for this site. Allow them in your browser settings.',
                  'error',
                );
                return;
              }
            }
            setPref('notifyTurn', v);
          }}
          label="Notify me on my turn"
          hint="a browser notification when the tab is in the background"
        />

        <div className="setting-group">
          <span className="setting-label">Card backs</span>
          <div className="seg">
            {CARD_BACKS.map((b) => (
              <button
                key={b.id}
                className={`seg-btn ${(prefs.cardBack ?? 'classic') === b.id ? 'on' : ''}`}
                onClick={() => setPref('cardBack', b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-group">
          <span className="setting-label">Chips</span>
          <div className="seg">
            {CHIP_STYLES.map((c) => (
              <button
                key={c.id}
                className={`seg-btn ${(prefs.chipStyle ?? 'plastic') === c.id ? 'on' : ''}`}
                onClick={() => setPref('chipStyle', c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

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
