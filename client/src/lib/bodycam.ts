import { onUnmounted, ref, shallowRef, watch, type ShallowRef } from 'vue';
import type { Socket } from 'socket.io-client';

/*
 * Body cams: one-way WebRTC. The player's phone publishes camera + microphone; staff screens receive.
 * The phone never adds a receiving track and never plays remote audio, so a player cannot hear the operator.
 * Video goes peer-to-peer over the local network; the server only relays signaling (see server/realtime.ts).
 * STUN helps when devices are on different networks; on an offline LAN the direct host candidates are used.
 */
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; type?: 'bye' | 'unavailable' };

// ------------------------------------------------------------------ publisher (crew phone)

export function useBodyCamPublisher(socketRef: ShallowRef<Socket | null>) {
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
    const pc = new RTCPeerConnection(ICE);
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
    const video: MediaTrackConstraints = {
      facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 },
    };
    try {
      try {
        stream.value = await navigator.mediaDevices.getUserMedia({
          video, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        // Microphone denied or missing: stream video only.
        stream.value = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }
      hasAudio.value = stream.value.getAudioTracks().length > 0;
      stream.value.getVideoTracks()[0]?.addEventListener('ended', stop);
      announce();
    } catch {
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
  playerId: number,
  onStream: (s: MediaStream) => void,
  onState: (s: FeedState, detail?: string) => void,
): () => void {
  const pc = new RTCPeerConnection(ICE);
  let peer: string | null = null;
  const pending: RTCIceCandidateInit[] = [];
  let closed = false;

  pc.ontrack = (e) => {
    onStream(e.streams[0] ?? new MediaStream([e.track]));
    onState('live');
  };
  pc.onicecandidate = (e) => e.candidate && peer && socket.emit('cam:signal', { to: peer, data: { candidate: e.candidate.toJSON() } });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') onState('error', 'НЕТ ПРЯМОГО СОЕДИНЕНИЯ');
    if (pc.connectionState === 'disconnected') onState('offline');
  };

  const onSignal = async ({ from, playerId: pid, data }: { from: string; playerId: number; data: Signal }) => {
    if (pid !== playerId || closed) return;
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

  socket.on('cam:signal', onSignal);
  socket.on('cam:error', onError);
  onState('connecting');
  socket.emit('cam:watch', { playerId });

  return () => {
    closed = true;
    if (peer) socket.emit('cam:signal', { to: peer, data: { type: 'bye' } });
    socket.off('cam:signal', onSignal);
    socket.off('cam:error', onError);
    pc.close();
  };
}
