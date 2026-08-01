import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
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

/** A labelled group of related settings. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {children}
    </section>
  );
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
  const toast = useStore((s) => s.toast);
  const mode = useStore((s) => s.mode);
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const game = useStore((s) => s.game);
  const updateSettings = useStore((s) => s.updateSettings);
  const setLocalBotDifficulty = useStore((s) => s.setLocalBotDifficulty);
  // the board actually on screen (room default or your override), which can
  // differ from prefs.boardTheme after the host set the board in the lobby
  const boardView = useStore((s) => s.boardView);

  // in an online room, the host can change the board for the whole table
  const isHost = mode === 'online' && !!room && room.hostId === playerId;
  const inGame = !!game;

  const pickBoard = (id: string, everyone: boolean) => {
    sfx.select();
    if (everyone) updateSettings({ boardTheme: id });
    else setPref('boardTheme', id);
  };

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

        <Section title="Profile">
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
        </Section>

        <Section title="Board & cards">
          <div className="setting-group">
            <span className="setting-label">Board</span>
            <div className="theme-grid">
              {BOARD_THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-opt ${boardView === t.id ? 'on' : ''}`}
                  data-board={t.id}
                  onClick={() => pickBoard(t.id, false)}
                >
                  <span className="theme-swatch" />
                  <span className="theme-name">{t.label}</span>
                </button>
              ))}
            </div>
            {isHost && (
              <button
                className="btn btn-secondary btn-sm apply-all"
                onClick={() => pickBoard(boardView, true)}
                title="Set the board you're viewing for every player in the room"
              >
                Use this board for everyone
              </button>
            )}
            {inGame && !isHost && mode === 'online' && (
              <i className="setting-note">The host can change the board for the whole table.</i>
            )}
          </div>

          <div className="setting-group">
            <span className="setting-label">Board shape</span>
            <div className="seg">
              {(
                [
                  ['portrait', 'Tall'],
                  ['landscape', 'Wide'],
                ] as const
              ).map(([v, lbl]) => (
                <button
                  key={v}
                  className={`seg-btn ${(prefs.boardLayout ?? 'portrait') === v ? 'on' : ''}`}
                  onClick={() => setPref('boardLayout', v)}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <i className="setting-note">
              Wide rotates the board to fill a wide screen (cards turn sideways).
            </i>
          </div>

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
        </Section>

        <Section title="Sound">
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
        </Section>

        <Section title="Accessibility">
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
        </Section>

        <Section title="Gameplay">
          <div className="setting-group">
            <span className="setting-label">Game level</span>
            <div className="seg">
              {(
                [
                  ['normal', 'Normal'],
                  ['hard', 'Hard'],
                ] as const
              ).map(([v, lbl]) => (
                <button
                  key={v}
                  className={`seg-btn ${(prefs.gameLevel ?? 'normal') === v ? 'on' : ''}`}
                  onClick={() => setPref('gameLevel', v)}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <i className="setting-note">
              Hard hides the highlighted spaces and the hint, so you read each card and find its
              own space on the board yourself.
            </i>
          </div>

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

          {mode === 'local' && inGame && (
            <div className="setting-group">
              <span className="setting-label">Bot difficulty (this game)</span>
              <div className="seg">
                {(['easy', 'medium', 'hard'] as const).map((d) => (
                  <button
                    key={d}
                    className={`seg-btn ${game?.settings.botDifficulty === d ? 'on' : ''}`}
                    onClick={() => setLocalBotDifficulty(d)}
                  >
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <i className="setting-note">Changes the bots right now, from their next turn.</i>
            </div>
          )}
        </Section>
      </motion.div>
    </div>
  );
}
