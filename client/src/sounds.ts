// Tiny WebAudio synth, no audio assets needed.

let ctx: AudioContext | null = null;
let muted = false;
let hapticsOn = true;

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}
export function setHaptics(on: boolean) {
  hapticsOn = on;
}
export function isHaptics() {
  return hapticsOn;
}

/** Fire a short vibration pattern on supporting devices (mostly Android). */
export function haptic(pattern: number | number[]) {
  if (!hapticsOn) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* vibration unavailable */
  }
}

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.15,
  when = 0,
  slideTo?: number,
) {
  if (muted) return;
  try {
    const a = ac();
    const t = a.currentTime + when;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    /* audio unavailable */
  }
}

function noise(dur: number, gain = 0.1, when = 0) {
  if (muted) return;
  try {
    const a = ac();
    const t = a.currentTime + when;
    const buffer = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = a.createBufferSource();
    src.buffer = buffer;
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t);
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  select: () => tone(660, 0.06, 'triangle', 0.08),
  place: () => {
    noise(0.08, 0.2);
    tone(220, 0.1, 'sine', 0.2);
    haptic(15);
  },
  remove: () => {
    tone(520, 0.16, 'sawtooth', 0.06, 0, 140);
    noise(0.1, 0.08, 0.04);
    haptic([12, 30, 12]);
  },
  draw: () => noise(0.12, 0.12),
  yourTurn: () => {
    tone(523, 0.12, 'sine', 0.12);
    tone(784, 0.18, 'sine', 0.12, 0.1);
    haptic(25);
  },
  sequence: () => {
    tone(523, 0.14, 'triangle', 0.14);
    tone(659, 0.14, 'triangle', 0.14, 0.12);
    tone(784, 0.2, 'triangle', 0.14, 0.24);
    tone(1047, 0.34, 'triangle', 0.16, 0.36);
    haptic([30, 40, 30, 40, 60]);
  },
  win: () => {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((n, i) => tone(n, 0.22, 'triangle', 0.14, i * 0.13));
    haptic([60, 50, 60, 50, 120]);
  },
  lose: () => {
    tone(392, 0.3, 'sine', 0.12);
    tone(311, 0.3, 'sine', 0.12, 0.25);
    tone(233, 0.5, 'sine', 0.12, 0.5);
    haptic(80);
  },
  error: () => {
    tone(160, 0.15, 'square', 0.05);
    haptic(40);
  },
  chat: () => tone(880, 0.08, 'sine', 0.06),
  emote: () => tone(990, 0.1, 'triangle', 0.08),
  tick: () => tone(440, 0.05, 'square', 0.05),
  timeout: () => {
    tone(300, 0.2, 'sawtooth', 0.08, 0, 180);
    haptic([50, 30, 50]);
  },
};
