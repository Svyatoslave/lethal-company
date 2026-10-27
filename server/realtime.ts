import type http from 'node:http';
import type https from 'node:https';
import { Server, type Socket } from 'socket.io';
import { actorFor } from './auth.js';
import { bus, type Actor, type FxTarget } from './game.js';
import { playerSnapshot, staffSnapshot } from './snapshot.js';
import type { FxEvent, FxName, Snapshot } from '../shared/types.js';

let io: Server | null = null;
const online = new Map<number, number>();

export function onlinePlayers() {
  return new Set([...online.entries()].filter(([, c]) => c > 0).map(([id]) => id));
}

function snapshotFor(actor: Actor, cache: Map<string, Snapshot>): Snapshot {
  const key = actor.role === 'player' ? `p${actor.playerId}` : actor.role;
  let s = cache.get(key);
  if (!s) {
    s = actor.role === 'player' ? playerSnapshot(actor.playerId!) : staffSnapshot(actor.role as 'admin' | 'operator', onlinePlayers());
    cache.set(key, s);
  }
  return s;
}

let timer: NodeJS.Timeout | null = null;
/** Coalesces bursts of mutations into one state push per ~40ms. Sockets only deliver state; SQLite holds it. */
export function scheduleBroadcast() {
  if (timer || !io) return;
  timer = setTimeout(() => {
    timer = null;
    const cache = new Map<string, Snapshot>();
    for (const socket of io!.of('/').sockets.values()) {
      const actor = socket.data.actor as Actor;
      socket.emit('state', snapshotFor(actor, cache));
    }
  }, 40);
}

function emitFx(name: FxName, payload: FxEvent, targets: FxTarget[]) {
  if (!io) return;
  if (targets.includes('all')) return void io.emit(name, payload);
  const rooms = new Set<string>();
  for (const t of targets) {
    if (typeof t === 'object') rooms.add(`player:${t.playerId}`);
    else if (t === 'staff') rooms.add('admin').add('operator');
    else rooms.add(t);
  }
  io.to([...rooms]).emit(name, payload);
}

export function attachRealtime(server: http.Server | https.Server) {
  io = new Server(server, { serveClient: false, pingInterval: 10_000, pingTimeout: 8_000 });

  io.use((socket, next) => {
    const actor = actorFor(socket.handshake.auth?.token);
    if (!actor) return next(new Error('unauthorized'));
    socket.data.actor = actor;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const actor = socket.data.actor as Actor;
    if (actor.role === 'player') {
      socket.join(['crew', `player:${actor.playerId}`]);
      online.set(actor.playerId!, (online.get(actor.playerId!) ?? 0) + 1);
    } else {
      socket.join(actor.role);
    }
    socket.emit('state', snapshotFor(actor, new Map()));
    socket.on('sync', () => socket.emit('state', snapshotFor(actor, new Map())));
    socket.on('disconnect', () => {
      if (actor.role === 'player') online.set(actor.playerId!, (online.get(actor.playerId!) ?? 1) - 1);
      scheduleBroadcast();
    });
    scheduleBroadcast();
  });

  bus.on('changed', scheduleBroadcast);
  bus.on('fx', (f: { name: FxName; payload: FxEvent; target: FxTarget[] }) => emitFx(f.name, f.payload, f.target));
  // Periodic resync so a device that missed a packet converges anyway.
  setInterval(scheduleBroadcast, 15_000);
}
