import { onUnmounted, ref, shallowRef, watch, type ShallowRef } from 'vue';
import type { Socket } from 'socket.io-client';
import { api } from './api';
import { setMicActive, unlockAudio } from './sound';
import type { App } from './session';

/*
 * Body cams: one-way WebRTC. The player's phone publishes camera + microphone; staff screens receive.
 * The phone never adds a receiving track and never plays remote audio, so a player cannot hear the operator.
 * Video goes peer-to-peer; the server only relays signaling (see server/realtime.ts). Inside one Wi-Fi the
 * direct host candidates work; across the internet the server-provided TURN relay carries the video.
 */
const FALLBACK_ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const iceCache = new Map<App, { cfg: RTCConfiguration; until: number }>();

/** ICE servers from the game server, including short-lived TURN credentials when a relay is configured. */
async function iceConfig(app: App): Promise<RTCConfiguration> {
  const hit = iceCache.get(app);
  if (hit && hit.until > Date.now()) return hit.cfg;
  try {
    const r = await api<{ iceServers: RTCIceServer[]; ttlSec: number }>(app, 'GET', '/ice');
    const cfg: RTCConfiguration = { iceServers: r.iceServers };
    // Refresh well before the TURN credentials expire.
    iceCache.set(app, { cfg, until: Date.now() + (r.ttlSec * 1000) / 2 });
    return cfg;
  } catch {
    return FALLBACK_ICE;
  }
}

type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; type?: 'bye' | 'unavailable' };

// ------------------------------------------------------------------ publisher (crew phone)

export function useBodyCamPublisher(socketRef: ShallowRef<Socket | null>, app: App = 'crew') {
  const stream = shallowRef<MediaStream | null>(null);
  const viewers = ref(0);
  const error = ref('');
  const starting = ref(false);
  const hasAudio = ref(false);
  const peers = new Map<string, RTCPeerConnection>();

  function dropPeer(id: string) {
    peers.get(id)?.close();
    peers.delete(id);
    viewers.value = peers.size;
  }

  async function onRequest({ from }: { from: string }) {
    const s = socketRef.value;
    if (!s) return;
    if (!stream.value) return void s.emit('cam:signal', { to: from, data: { type: 'unavailable' } });
    dropPeer(from);
    const cfg = await iceConfig(app);
    if (!stream.value) return;
    const pc = new RTCPeerConnection(cfg);
    peers.set(from, pc);
    viewers.value = peers.size;
    for (const t of stream.value.getTracks()) pc.addTransceiver(t, { direction: 'sendonly', streams: [stream.value] });
    pc.onicecandidate = (e) => e.candidate && s.emit('cam:signal', { to: from, data: { candidate: e.candidate.toJSON() } });
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) dropPeer(from);
    };
    await pc.setLocalDescription(await pc.createOffer());
    s.emit('cam:signal', { to: from, data: { sdp: pc.localDescription!.toJSON() } });
  }

  async function onSignal({ from, data }: { from: string; data: Signal }) {
    const pc = peers.get(from);
    if (!pc) return;
    try {
      if (data.sdp) await pc.setRemoteDescription(data.sdp);
      else if (data.candidate) await pc.addIceCandidate(data.candidate);
      else if (data.type === 'bye') dropPeer(from);
    } catch {
      dropPeer(from);
    }
  }

  function announce() {
    socketRef.value?.emit('cam:state', { on: !!stream.value });
  }

  watch(
    socketRef,
    (s, old) => {
      old?.off('cam:request', onRequest).off('cam:signal', onSignal).off('connect', announce);
      s?.on('cam:request', onRequest).on('cam:signal', onSignal).on('connect', announce);
      if (s?.connected) announce();
    },
    { immediate: true },
  );

  async function start() {
    if (stream.value || starting.value) return;
    error.value = '';
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      error.value = 'Камера доступна только по HTTPS.';
      return;
    }
    starting.value = true;
    setMicActive(true);
    const video: MediaTrackConstraints = {
      facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 },
    };
    try {
      try {
        // Voice processing is off on purpose: the phone never plays the operator back, so there is no echo to
        // cancel, and on Android these filters switch the phone into "call" mode, where game signals become
        // quiet or come out of the earpiece.
        stream.value = await navigator.mediaDevices.getUserMedia({
          video, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        // Microphone denied or missing: stream video only.
        stream.value = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }
      hasAudio.value = stream.value.getAudioTracks().length > 0;
      setMicActive(hasAudio.value);
      // Still inside the tap's activation window: bring signal audio back if capture interrupted it.
      unlockAudio();
      stream.value.getVideoTracks()[0]?.addEventListener('ended', stop);
      announce();
    } catch {
      setMicActive(false);
      error.value = 'Нет доступа к камере. Разрешите камеру в настройках браузера.';
    } finally {
      starting.value = false;
    }
  }

  function stop() {
    for (const id of [...peers.keys()]) {
      socketRef.value?.emit('cam:signal', { to: id, data: { type: 'bye' } });
      dropPeer(id);
    }
    stream.value?.getTracks().forEach((t) => t.stop());
    stream.value = null;
    hasAudio.value = false;
    setMicActive(false);
    announce();
  }

  onUnmounted(() => {
    stop();
    socketRef.value?.off('cam:request', onRequest).off('cam:signal', onSignal).off('connect', announce);
  });

  return { stream, viewers, error, starting, hasAudio, start, stop };
}

// ------------------------------------------------------------------ viewer (operator / admin)

export type FeedState = 'connecting' | 'live' | 'offline' | 'error';

/** Opens one receive-only connection to a player's body cam. Returns a cleanup function. */
export function watchBodyCam(
  socket: Socket,
  app: App,
  playerId: number,
  onStream: (s: MediaStream) => void,
  onState: (s: FeedState, detail?: string) => void,
): () => void {
  let pc: RTCPeerConnection | null = null;
  let peer: string | null = null;
  const pending: RTCIceCandidateInit[] = [];
  let closed = false;

  const onSignal = async ({ from, playerId: pid, data }: { from: string; playerId: number; data: Signal }) => {
    if (pid !== playerId || closed || !pc) return;
    try {
      if (data.sdp) {
        peer = from;
        await pc.setRemoteDescription(data.sdp);
        for (const c of pending.splice(0)) await pc.addIceCandidate(c);
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('cam:signal', { to: from, data: { sdp: pc.localDescription!.toJSON() } });
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pending.push(data.candidate);
      } else if (data.type === 'unavailable' || data.type === 'bye') {
        onState('offline');
      }
    } catch {
      onState('error', 'СБОЙ СОЕДИНЕНИЯ');
    }
  };
  const onError = (p: { playerId: number; error: string }) => p.playerId === playerId && onState('error', p.error);

  onState('connecting');
  void iceConfig(app).then((cfg) => {
    if (closed) return;
    const conn = new RTCPeerConnection(cfg);
    pc = conn;
    conn.ontrack = (e) => {
      onStream(e.streams[0] ?? new MediaStream([e.track]));
      onState('live');
    };
    conn.onicecandidate = (e) => e.candidate && peer && socket.emit('cam:signal', { to: peer, data: { candidate: e.candidate.toJSON() } });
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'failed') onState('error', 'НЕТ СОЕДИНЕНИЯ — НУЖЕН TURN');
      if (conn.connectionState === 'disconnected') onState('offline');
    };
    socket.on('cam:signal', onSignal);
    socket.on('cam:error', onError);
    socket.emit('cam:watch', { playerId });
  });

  return () => {
    closed = true;
    if (peer) socket.emit('cam:signal', { to: peer, data: { type: 'bye' } });
    socket.off('cam:signal', onSignal);
    socket.off('cam:error', onError);
    pc?.close();
  };
}
