import { ref } from 'vue';
import { pref, setPref } from './session';

let ctx: AudioContext | null = null;
export const muted = ref(pref('muted', '0') === '1');
/** True once the browser allowed audio (needs one tap on the page). */
export const audioReady = ref(false);

function audio() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    ctx.addEventListener('statechange', () => (audioReady.value = ctx?.state === 'running'));
  }
  // 'suspended' (no gesture yet) and iOS 'interrupted' (call, mic capture, app switch) both need a resume.
  if (ctx.state !== 'running') void ctx.resume().then(() => (audioReady.value = ctx?.state === 'running')).catch(() => undefined);
  audioReady.value = ctx.state === 'running';
  return ctx;
}

/*
 * iOS (Safari 17+) audio session. 'playback' lets signals play through the silent switch, but it cannot
 * coexist with microphone capture: while the BODY CAM microphone is live the session must be
 * 'play-and-record', otherwise iOS silences page audio (or the mic). The body cam flips this flag.
 */
let micActive = false;
function applySession() {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = micActive ? 'play-and-record' : 'playback';
}
export function setMicActive(on: boolean) {
  micActive = on;
  applySession();
  audio();
}

/** Must run inside a user gesture. Also plays a silent buffer, which iOS Safari needs to really unlock output. */
export function unlockAudio() {
  applySession();
  const a = audio();
  if (!a) return;
  const src = a.createBufferSource();
  src.buffer = a.createBuffer(1, 1, 22050);
  src.connect(a.destination);
  src.start(0);
}

// Browsers only allow audio after a user gesture. Audio can also be lost later (mic capture, phone call,
// screen lock), so every tap re-checks it — cheap when it is already running.
const ensureAudio = () => {
  if (!audioReady.value) unlockAudio();
};
['pointerdown', 'touchend', 'click'].forEach((e) => window.addEventListener(e, ensureAudio, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx) audio();
});

export function toggleMuted() {
  muted.value = !muted.value;
  setPref('muted', muted.value ? '1' : '0');
}

type Note = [freq: number, dur: number, type: OscillatorType | 'noise'];
const PATTERNS: Record<string, { gain: number; notes: Note[] }> = {
  ok: { gain: 0.06, notes: [[880, 0.07, 'square'], [1320, 0.09, 'square']] },
  info: { gain: 0.06, notes: [[660, 0.06, 'square']] },
  msg: { gain: 0.06, notes: [[990, 0.05, 'square'], [0, 0.04, 'square'], [990, 0.05, 'square']] },
  // Walkie-talkie: one squelch burst and a rising two-tone chirp. Loud enough for a pocket, played once per message.
  radio: {
    gain: 0.3,
    notes: [[0, 0.14, 'noise'], [0, 0.04, 'square'], [1200, 0.1, 'square'], [1600, 0.18, 'square']],
  },
  warn: { gain: 0.08, notes: [[440, 0.12, 'sawtooth'], [0, 0.06, 'square'], [440, 0.12, 'sawtooth']] },
  crit: { gain: 0.1, notes: [[220, 0.18, 'sawtooth'], [180, 0.18, 'sawtooth'], [220, 0.18, 'sawtooth'], [180, 0.25, 'sawtooth']] },
};

let noiseBuffer: AudioBuffer | null = null;
function noise(a: AudioContext) {
  if (!noiseBuffer) {
    noiseBuffer = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

export function beep(kind = 'info') {
  if (muted.value) return;
  const a = audio();
  if (!a) return;
  const p = PATTERNS[kind] ?? PATTERNS.info;
  let t = a.currentTime + 0.01;
  for (const [freq, dur, type] of p.notes) {
    const g = a.createGain();
    g.gain.setValueAtTime(p.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(a.destination);
    if (type === 'noise') {
      const src = a.createBufferSource();
      src.buffer = noise(a);
      src.connect(g);
      src.start(t);
      src.stop(t + dur);
    } else if (freq) {
      const o = a.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
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

/** Keeps the phone screen on while the page is visible, so signals are not missed in a pocket. */
let lock: { release(): Promise<void> } | null = null;
export const keepAwake = ref(pref('awake', '1') === '1');
export const keepAwakeSupported = 'wakeLock' in navigator;

async function acquire() {
  if (!keepAwake.value || !keepAwakeSupported || document.visibilityState !== 'visible' || lock) return;
  try {
    lock = await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void>; addEventListener(e: string, f: () => void): void }> } }).wakeLock.request('screen');
    (lock as unknown as { addEventListener(e: string, f: () => void): void }).addEventListener('release', () => (lock = null));
  } catch {
    lock = null;
  }
}
export function startKeepAwake() {
  void acquire();
  document.addEventListener('visibilitychange', () => void acquire());
}
export async function toggleKeepAwake() {
  keepAwake.value = !keepAwake.value;
  setPref('awake', keepAwake.value ? '1' : '0');
  if (keepAwake.value) await acquire();
  else {
    await lock?.release().catch(() => undefined);
    lock = null;
  }
}
