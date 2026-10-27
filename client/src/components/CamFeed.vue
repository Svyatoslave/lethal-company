<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { Socket } from 'socket.io-client';
import { watchBodyCam, type FeedState } from '../lib/bodycam';
import { clock } from '../lib/format';

const props = defineProps<{ socket: Socket; playerId: number; callsign: string; channel: number; audible?: boolean; now: number; small?: boolean }>();

const video = ref<HTMLVideoElement | null>(null);
const state = ref<FeedState>('connecting');
const detail = ref('');
const needsTap = ref(false);
const hasAudio = ref(false);
let stop: (() => void) | null = null;

async function applyAudio() {
  const v = video.value;
  if (!v) return;
  v.muted = !props.audible;
  try {
    await v.play();
    needsTap.value = false;
  } catch (e) {
    // A newer play() call superseded this one: not an autoplay block.
    if ((e as DOMException).name === 'AbortError') return;
    // Browsers block audible autoplay without a gesture; fall back to muted video and ask for a click.
    v.muted = true;
    needsTap.value = !!props.audible;
    void v.play().catch(() => undefined);
  }
}

function connect() {
  stop?.();
  stop = watchBodyCam(
    props.socket,
    'operator',
    props.playerId,
    (s) => {
      // ontrack fires once per track (video, audio) with the same stream: attach it only once.
      hasAudio.value = s.getAudioTracks().length > 0;
      if (video.value && video.value.srcObject !== s) {
        video.value.srcObject = s;
        void applyAudio();
      }
    },
    (s, d) => {
      state.value = s;
      detail.value = d ?? '';
    },
  );
}

onMounted(connect);
onUnmounted(() => stop?.());
watch(() => props.audible, applyAudio);
</script>

<template>
  <div class="feed" :class="[state, { small }]">
    <video ref="video" autoplay playsinline muted />
    <div class="osd mono">
      <span class="ch">CAM-{{ String(channel).padStart(2, '0') }} · {{ callsign }}</span>
      <span v-if="state === 'live'" class="rec"><i />LIVE</span>
      <span class="ts">{{ clock(now) }}</span>
    </div>
    <div v-if="state !== 'live'" class="msg mono">
      <template v-if="state === 'connecting'">ESTABLISHING LINK<span class="blink">_</span></template>
      <template v-else-if="state === 'offline'">NO SIGNAL</template>
      <template v-else>{{ detail || 'SIGNAL LOST' }}</template>
      <button v-if="state !== 'connecting'" type="button" class="retry" @click="connect">ПОВТОРИТЬ</button>
    </div>
    <button v-if="needsTap && state === 'live'" type="button" class="tap mono" @click="needsTap = false; applyAudio()">🔊 ВКЛЮЧИТЬ ЗВУК</button>
    <span v-if="audible && state === 'live' && !needsTap && hasAudio" class="aud mono">🔊 AUDIO</span>
    <span v-else-if="audible && state === 'live' && !hasAudio" class="aud mono dim">NO MIC</span>
  </div>
</template>

<style scoped>
.feed {
  position: relative;
  background: #020302;
  overflow: hidden;
  border: 1px solid var(--line-2);
  aspect-ratio: 4 / 3;
}
video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* Night-vision monitor look. */
  filter: grayscale(1) sepia(0.35) hue-rotate(50deg) saturate(2.2) contrast(1.15) brightness(1.1);
}
.feed::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.28) 0 1px, transparent 1px 3px),
    radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.7));
}
.osd {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--acc);
  text-shadow: 0 0 6px #000, 0 0 2px #000;
}
.small .osd {
  font-size: 10.5px;
  padding: 5px 7px;
}
.ch {
  font-weight: 800;
}
.ts {
  margin-left: auto;
}
.rec {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--red);
}
.rec i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
  animation: blink 1s steps(2) infinite;
}
.msg {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 18px;
  letter-spacing: 0.2em;
  color: var(--text-dim);
  background:
    repeating-radial-gradient(circle at 30% 40%, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 3px),
    #050706;
}
.small .msg {
  font-size: 12px;
}
.error .msg,
.offline .msg {
  color: var(--red);
}
.retry,
.tap {
  z-index: 3;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid var(--acc-2);
  color: var(--acc);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  cursor: pointer;
}
.tap {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  border-color: var(--amber);
  color: var(--amber);
}
.aud {
  position: absolute;
  bottom: 8px;
  right: 10px;
  z-index: 2;
  font-size: 11px;
  color: var(--acc);
  text-shadow: 0 0 4px #000;
}
</style>
