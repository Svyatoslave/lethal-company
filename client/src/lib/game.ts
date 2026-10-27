import { onUnmounted, reactive, ref, shallowRef } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { FX_EVENTS, type FxEvent, type FxName, type Snapshot } from '@shared/types';
import { api } from './api';
import { clearToken, tokenOf, type App } from './session';
import { toast } from './toast';
import { beep, vibrate } from './sound';

export interface Alert extends FxEvent { id: number; name: FxName }
export type FxRoute = 'alert' | 'toast' | 'ignore';

/**
 * Live connection to the game server for one interface. The server pushes full role-filtered
 * snapshots; this composable never derives game state on its own — it only renders what it receives.
 */
export function useGame(app: App, route: (name: FxName, fx: FxEvent, state: Snapshot | null) => FxRoute) {
  const state = shallowRef<Snapshot | null>(null);
  const connected = ref(false);
  const authed = ref(!!tokenOf(app));
  const offset = ref(0);
  const now = ref(Date.now());
  const alerts = ref<Alert[]>([]);
  const busy = reactive(new Set<string>());
  let socket: Socket | null = null;
  let seq = 0;

  const clockTimer = setInterval(() => (now.value = Date.now() + offset.value), 250);

  function dismiss(id: number) {
    alerts.value = alerts.value.filter((a) => a.id !== id);
  }

  function onFx(name: FxName, fx: FxEvent) {
    const r = route(name, fx, state.value);
    if (r === 'ignore') return;
    const sound = name === 'message:received' ? 'msg' : fx.level;
    beep(sound);
    if (r === 'toast') return toast(fx.text ? `${fx.title} · ${fx.text}` : fx.title, fx.level);
    if (fx.level === 'crit') vibrate([300, 120, 300, 120, 600]);
    else if (fx.level === 'warn') vibrate([200, 100, 200]);
    const id = ++seq;
    alerts.value = [...alerts.value.slice(-2), { ...fx, name, id }];
    setTimeout(() => dismiss(id), fx.level === 'crit' ? 9000 : 5500);
  }

  function connect() {
    disconnect();
    const token = tokenOf(app);
    if (!token) return void (authed.value = false);
    authed.value = true;
    socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => (connected.value = true));
    socket.on('disconnect', () => (connected.value = false));
    socket.on('connect_error', (err) => {
      connected.value = false;
      if (err.message === 'unauthorized') {
        clearToken(app);
        authed.value = false;
        socket?.disconnect();
      }
    });
    socket.on('state', (s: Snapshot) => {
      offset.value = s.serverNow - Date.now();
      now.value = s.serverNow;
      state.value = s;
    });
    for (const name of FX_EVENTS) socket.on(name, (fx: FxEvent) => onFx(name, fx));
  }

  function disconnect() {
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
    connected.value = false;
  }

  function logout() {
    void api(app, 'POST', '/auth/logout').catch(() => undefined);
    clearToken(app);
    disconnect();
    state.value = null;
    authed.value = false;
  }

  /** Runs a server command once at a time per key; failures surface as a toast with the server's reason. */
  async function act<T>(key: string, method: string, url: string, body?: unknown, okText?: string): Promise<T | undefined> {
    if (busy.has(key)) return;
    busy.add(key);
    try {
      const r = await api<T>(app, method, url, body);
      if (okText) toast(okText, 'ok');
      return r;
    } catch (e) {
      beep('warn');
      toast((e as Error).message, 'crit', 5000);
      if (!tokenOf(app)) {
        authed.value = false;
        disconnect();
      }
      return undefined;
    } finally {
      busy.delete(key);
    }
  }

  onUnmounted(() => {
    clearInterval(clockTimer);
    disconnect();
  });

  return { state, connected, authed, now, alerts, busy, connect, disconnect, logout, dismiss, act };
}

export type Game = ReturnType<typeof useGame>;
