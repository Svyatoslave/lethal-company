<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import jsQR from 'jsqr';
import { vibrate } from '../lib/sound';
import TButton from './ui/TButton.vue';

/** When the body cam is already streaming, the scanner reads the same camera instead of opening it twice. */
const props = defineProps<{ stream?: MediaStream | null }>();
const emit = defineEmits<{ detected: [token: string]; close: [] }>();

const video = ref<HTMLVideoElement | null>(null);
const error = ref('');
const hint = ref('НАВЕДИТЕ НА QR-МЕТКУ ПРЕДМЕТА ИЛИ ТЕРМИНАЛА');
const torchAvailable = ref(false);
const torchOn = ref(false);
let stream: MediaStream | null = null;
let raf = 0;
let last = 0;
let done = false;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

/** Terminal links retain their kind; bare tokens remain scrap-compatible. */
function parseToken(raw: string): string | null {
  const terminal = raw.match(/\/t\/([A-Za-z0-9_-]{10,64})(?:[/?#]|$)/);
  if (terminal) return `terminal:${terminal[1]}`;
  const link = raw.match(/\/s\/([A-Za-z0-9_-]{10,64})(?:[/?#]|$)/);
  if (link) return link[1];
  return /^[A-Za-z0-9_-]{10,64}$/.test(raw.trim()) ? raw.trim() : null;
}

function loop(t: number) {
  raf = requestAnimationFrame(loop);
  if (done || t - last < 150 || !ctx) return;
  last = t;
  const v = video.value;
  if (!v || v.readyState < 2 || !v.videoWidth) return;
  const w = 640;
  const h = Math.round((v.videoHeight / v.videoWidth) * w);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(v, 0, 0, w, h);
  const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
  if (!code?.data) return;
  const token = parseToken(code.data);
  if (!token) {
    hint.value = 'ЧУЖОЙ КОД — ЭТО НЕ МЕТКА КОМПАНИИ';
    return;
  }
  done = true;
  vibrate(90);
  emit('detected', token);
}

async function start() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    error.value = 'Камера доступна только по HTTPS. Отсканируйте метку обычной камерой телефона — ссылка откроет это приложение.';
    return;
  }
  try {
    stream = props.stream
      ? new MediaStream(props.stream.getVideoTracks())
      : await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
    if (!video.value) return stop();
    video.value.srcObject = stream;
    await video.value.play();
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    torchAvailable.value = !!caps?.torch;
    raf = requestAnimationFrame(loop);
  } catch {
    error.value = 'Нет доступа к камере. Разрешите камеру в настройках браузера или отсканируйте метку обычной камерой телефона.';
  }
}

async function toggleTorch() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn.value = !torchOn.value;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn.value } as MediaTrackConstraintSet] });
  } catch {
    torchAvailable.value = false;
  }
}

function stop() {
  cancelAnimationFrame(raf);
  // A borrowed body cam track keeps streaming to the operator after the scanner closes.
  if (!props.stream) stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

onMounted(start);
onUnmounted(stop);
</script>

<template>
  <div class="scanner">
    <div class="view">
      <video ref="video" playsinline muted />
      <div class="reticle"><i /><i /><i /><i /><span class="sweep" /></div>
      <div class="hud mono">SCRAP SCANNER · ACTIVE</div>
    </div>
    <div class="bottom">
      <div v-if="error" class="err">{{ error }}</div>
      <div v-else class="hint mono">{{ hint }}<span class="blink">_</span></div>
      <div class="row">
        <TButton v-if="torchAvailable" variant="warn" size="lg" class="grow" @click="toggleTorch">{{ torchOn ? 'ФОНАРЬ ВЫКЛ' : 'ФОНАРЬ' }}</TButton>
        <TButton variant="ghost" size="lg" class="grow" @click="emit('close')">ОТМЕНА</TButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scanner {
  position: fixed;
  inset: 0;
  z-index: 700;
  display: flex;
  flex-direction: column;
  background: #000;
}
.view {
  position: relative;
  flex: 1;
  overflow: hidden;
}
video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.4) contrast(1.15) brightness(1.05);
}
.reticle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(68vw, 300px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
}
.reticle i {
  position: absolute;
  width: 34px;
  height: 34px;
  border: 3px solid var(--acc);
  filter: drop-shadow(0 0 6px var(--acc));
}
.reticle i:nth-child(1) {
  top: 0;
  left: 0;
  border-width: 3px 0 0 3px;
}
.reticle i:nth-child(2) {
  top: 0;
  right: 0;
  border-width: 3px 3px 0 0;
}
.reticle i:nth-child(3) {
  bottom: 0;
  left: 0;
  border-width: 0 0 3px 3px;
}
.reticle i:nth-child(4) {
  bottom: 0;
  right: 0;
  border-width: 0 3px 3px 0;
}
.sweep {
  position: absolute;
  left: 6%;
  right: 6%;
  height: 2px;
  background: var(--acc);
  box-shadow: 0 0 12px var(--acc);
  animation: sweep 1.8s ease-in-out infinite alternate;
}
@keyframes sweep {
  from {
    top: 6%;
  }
  to {
    top: 94%;
  }
}
.hud {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 12px;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--acc);
  background: rgba(0, 0, 0, 0.6);
  padding: 4px 8px;
}
.bottom {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px calc(16px + var(--safe-b));
  background: var(--bg);
  border-top: 1px solid var(--acc-2);
}
.hint {
  font-size: 13px;
  color: var(--acc);
  letter-spacing: 0.1em;
  text-align: center;
}
.err {
  font-size: 15px;
  color: var(--amber);
}
</style>
