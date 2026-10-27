<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { io } from 'socket.io-client';
import { tokenOf, type App } from '../lib/session';

const props = defineProps<{ app: App; publish?: boolean; suspended?: boolean }>();
type Source = { id: string; playerId: number; callsign: string };
const sources = ref<Source[]>([]);
const selected = ref<number | ''>('');
const enabled = ref(false);
const busy = ref(false);
const status = ref('Камера выключена');
const error = ref('');
const video = ref<HTMLVideoElement>();
const media = ref<MediaStream | null>(null);
const facing = ref<'environment' | 'user'>('environment');
const socket = io('/cameras', { autoConnect: false, auth: { token: tokenOf(props.app) } });
type Peer = { pc: RTCPeerConnection; queue: RTCIceCandidateInit[] };
const peers = new Map<string, Peer>();
let target: string | null = null;
let generation = 0;
let alive = true;
let lastAttempt = 0;
const title = computed(() => props.publish ? 'МОЯ КАМЕРА' : props.app === 'operator' ? 'КАМЕРЫ СОТРУДНИКОВ' : 'КАМЕРЫ МОНСТРОВ');

watch(media, stream => { if (video.value) video.value.srcObject = stream; }, { flush: 'post' });
function closePeer(id: string) {
  const peer = peers.get(id);
  peers.delete(id);
  if (peer) { peer.pc.onconnectionstatechange = null; peer.pc.close(); }
}
function closePeers() { for (const id of peers.keys()) closePeer(id); }
function stopMedia() {
  generation++;
  media.value?.getTracks().forEach(t => t.stop());
  media.value = null;
  closePeers();
}
function makePeer(id: string) {
  closePeer(id);
  const pc = new RTCPeerConnection({ iceServers: [] });
  const peer: Peer = { pc, queue: [] };
  peers.set(id, peer);
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('camera:signal', { to: id, candidate: e.candidate.toJSON() });
  };
  pc.ontrack = e => {
    if (!props.publish) { media.value = new MediaStream([e.track]); status.value = 'ПРЯМОЙ ЭФИР · БЕЗ ЗВУКА'; }
  };
  pc.onconnectionstatechange = () => {
    if (props.publish) return;
    if (pc.connectionState === 'connected') status.value = 'ПРЯМОЙ ЭФИР · БЕЗ ЗВУКА';
    else if (['failed', 'disconnected'].includes(pc.connectionState)) {
      status.value = 'Связь потеряна. Восстановление…';
      media.value = null;
    }
  };
  return peer;
}
async function startMedia() {
  if (!enabled.value || props.suspended || busy.value) return;
  stopMedia();
  const version = generation;
  busy.value = true;
  error.value = '';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера доступна только через HTTPS в поддерживаемом браузере.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      facingMode: { ideal: facing.value }, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 },
    } });
    if (!alive || version !== generation || !enabled.value || props.suspended) {
      stream.getTracks().forEach(t => t.stop()); return;
    }
    media.value = stream;
    stream.getVideoTracks()[0].onended = () => {
      stopMedia(); socket.emit('camera:publish', false); status.value = 'Камера прервана. Повторное подключение…';
    };
    socket.emit('camera:publish', true);
    status.value = socket.connected ? 'ТРАНСЛЯЦИЯ ВКЛЮЧЕНА · БЕЗ ЗВУКА' : 'Ожидание связи с сервером…';
  } catch (e) {
    enabled.value = false;
    error.value = `Не удалось включить камеру: ${(e as Error).message}`;
  } finally { busy.value = false; }
}
function toggle() {
  enabled.value = !enabled.value;
  if (enabled.value) void startMedia();
  else { stopMedia(); socket.emit('camera:publish', false); status.value = 'Камера выключена'; }
}
function subscribe(force = false) {
  const source = sources.value.find(s => s.playerId === selected.value);
  if (!force && source?.id === target) return;
  closePeers(); media.value = null;
  target = source?.id ?? null;
  lastAttempt = Date.now();
  socket.emit('camera:unwatch');
  if (target) { status.value = 'Подключение к камере…'; socket.emit('camera:watch', target); }
  else status.value = selected.value ? 'Камера недоступна. Ожидание…' : 'Выберите камеру';
}
watch(selected, () => subscribe(true));
watch(() => props.suspended, suspended => {
  if (!props.publish || !enabled.value) return;
  if (suspended) { stopMedia(); socket.emit('camera:publish', false); status.value = 'Трансляция приостановлена на время сканирования'; }
  else void startMedia();
});
socket.on('connect', () => {
  error.value = '';
  if (props.publish) {
    if (media.value?.active) socket.emit('camera:publish', true);
    else if (enabled.value) void startMedia();
  } else { target = null; subscribe(true); }
});
socket.on('disconnect', () => {
  closePeers(); target = null;
  if (!props.publish) media.value = null;
  status.value = 'Связь с сервером потеряна. Восстановление…';
});
socket.on('connect_error', e => {
  if (e.message === 'unauthorized') {
    enabled.value = false; stopMedia(); socket.disconnect();
    error.value = 'Сессия завершена. Выйдите и войдите снова.';
  } else status.value = 'Сервер недоступен. Восстановление…';
});
socket.on('camera:list', (list: Source[]) => { sources.value = list; if (!props.publish) subscribe(); });
socket.on('camera:ended', () => { closePeers(); media.value = null; target = null; status.value = 'Камера недоступна. Ожидание…'; });
socket.on('camera:replaced', () => {
  enabled.value = false; stopMedia(); status.value = 'Камера включена на другом устройстве';
});
socket.on('camera:leave', ({ viewer }: { viewer: string }) => closePeer(viewer));
socket.on('camera:viewer', async ({ viewer }: { viewer: string }) => {
  if (!props.publish || !media.value?.active) return;
  const { pc } = makePeer(viewer);
  try {
    for (const track of media.value.getVideoTracks()) pc.addTrack(track, media.value);
    await pc.setLocalDescription(await pc.createOffer());
    if (peers.get(viewer)?.pc === pc) socket.emit('camera:signal', { to: viewer, description: pc.localDescription });
  } catch { closePeer(viewer); }
});
socket.on('camera:signal', async ({ from, description, candidate }: {
  from: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit;
}) => {
  if (!props.publish && from !== target) return;
  let peer = peers.get(from);
  if (!peer && !props.publish && description?.type === 'offer') peer = makePeer(from);
  if (!peer) return;
  const { pc } = peer;
  try {
    if (description) {
      if (description.type !== (props.publish ? 'answer' : 'offer')) return;
      await pc.setRemoteDescription(description);
      for (const ice of peer.queue.splice(0)) await pc.addIceCandidate(ice);
      if (description.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('camera:signal', { to: from, description: pc.localDescription });
      }
    }
    if (candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else peer.queue.push(candidate);
    }
  } catch { closePeer(from); }
});
const retry = setInterval(() => {
  if (!socket.connected) return;
  if (props.publish) {
    if (enabled.value && !props.suspended && !media.value?.active) void startMedia();
  } else if (selected.value && Date.now() - lastAttempt > 12000 &&
    (!target || peers.get(target)?.pc.connectionState !== 'connected')) subscribe(true);
}, 3000);
onMounted(() => { socket.connect(); if (!props.publish) status.value = 'Выберите камеру'; });
onUnmounted(() => { alive = false; clearInterval(retry); stopMedia(); socket.disconnect(); });
</script>

<template>
  <section class="camera">
    <b class="mono">{{ title }}</b>
    <template v-if="publish">
      <p>Видео видят {{ app === 'crew' ? 'уполномоченные зрители' : 'зрители' }}. Без звука и записи. Держите страницу открытой и телефон разблокированным.</p>
      <div class="controls">
        <button class="input" :disabled="busy || suspended" @click="toggle">{{ enabled ? '■ ВЫКЛЮЧИТЬ КАМЕРУ' : '● ВКЛЮЧИТЬ КАМЕРУ' }}</button>
        <select v-model="facing" class="input" :disabled="busy" @change="enabled && startMedia()">
          <option value="environment">Основная камера</option><option value="user">Фронтальная камера</option>
        </select>
      </div>
    </template>
    <template v-else>
      <select v-model="selected" class="input" aria-label="Выбор камеры">
        <option value="">Не смотреть</option>
        <option v-if="selected && !sources.some(s => s.playerId === selected)" :value="selected">Выбранная камера — нет связи</option>
        <option v-for="s in sources" :key="s.id" :value="s.playerId">{{ s.callsign }}</option>
      </select>
      <p v-if="!sources.length">Нет включённых камер.</p>
    </template>
    <video v-show="media" ref="video" autoplay playsinline muted controls />
    <span role="status" class="mono">{{ status }}</span>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <button v-if="media && !publish" class="input" @click="video?.play()">▶ Воспроизвести</button>
  </section>
</template>

<style scoped>
.camera { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--line-2); background: var(--panel); min-width: 0; }
p { margin: 0; font-size: 13px; color: var(--text-mute); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; }
video { width: 100%; max-height: 55dvh; background: #000; object-fit: contain; }
.error { color: var(--red); }
</style>
