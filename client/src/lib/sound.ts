import { ref } from 'vue';
import { pref, setPref } from './session';

let ctx: AudioContext | null = null;
export const muted = ref(pref('muted', '0') === '1');

function audio() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture: unlock on the first tap.
const unlock = () => {
  audio();
  window.removeEventListener('pointerdown', unlock);
};
window.addEventListener('pointerdown', unlock);

export function toggleMuted() {
  muted.value = !muted.value;
  setPref('muted', muted.value ? '1' : '0');
}

type Note = [freq: number, dur: number, type: OscillatorType];
const PATTERNS: Record<string, Note[]> = {
  ok: [[880, 0.07, 'square'], [1320, 0.09, 'square']],
  info: [[660, 0.06, 'square']],
  msg: [[990, 0.05, 'square'], [0, 0.04, 'square'], [990, 0.05, 'square']],
  warn: [[440, 0.12, 'sawtooth'], [0, 0.06, 'square'], [440, 0.12, 'sawtooth']],
  crit: [[220, 0.18, 'sawtooth'], [180, 0.18, 'sawtooth'], [220, 0.18, 'sawtooth'], [180, 0.25, 'sawtooth']],
};

export function beep(kind = 'info') {
  if (muted.value) return;
  const a = audio();
  if (!a) return;
  let t = a.currentTime;
  for (const [freq, dur, type] of PATTERNS[kind] ?? PATTERNS.info) {
    if (freq) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur);
    }
    t += dur;
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
