import type http from 'node:http';
import type https from 'node:https';
import { Server, type Socket } from 'socket.io';
import { actorFor } from './auth.js';
import { bus, currentMission, isInfected, type Actor, type FxTarget } from './game.js';
import { presence } from './presence.js';
import { playerSnapshot, staffSnapshot } from './snapshot.js';
import type { FxEvent, FxName, Snapshot } from '../shared/types.js';

let io: Server | null = null;

function snapshotFor(actor: Actor, cache: Map<string, Snapshot>): Snapshot {
  const key = actor.role === 'player' ? `p${actor.playerId}` : actor.role;
  let s = cache.get(key);
  if (!s) {
    s = actor.role === 'player' ? playerSnapshot(actor.playerId!) : staffSnapshot(actor.role as 'admin' | 'operator');
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
      const actor = actorFor(socket.handshake.auth?.token) ?? socket.data.actor as Actor;
      const previous = socket.data.actor as Actor;
      socket.data.actor = actor;
      if (actor.role === 'player' && actor.playerRole !== previous.playerRole) {
        void socket.leave(actor.playerRole === 'monster' ? 'crew' : 'monsters');
        void socket.join(actor.playerRole === 'monster' ? 'monsters' : 'crew');
      }
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

/**
 * Body cam signaling. Video flows peer-to-peer (WebRTC) from the player's phone to a staff screen;
 * the server only relays offers/answers/ICE candidates, and only between a player and staff.
 */
function bindBodyCam(socket: Socket, actor: Actor) {
  const camAllowed = () => {
    const m = currentMission();
    if (!m || !m.cams_unlocked) return 'BODY CAM НЕ КУПЛЕНА';
    if (m.comms_disabled) return 'СИГНАЛ ПОТЕРЯН';
    if (actor.role === 'player' && isInfected(m.id, actor.playerId!)) return 'СИГНАЛ ПОТЕРЯН';
    return null;
  };

  socket.on('cam:state', (p: { on?: boolean }) => {
    if (actor.role !== 'player') return;
    const on = !!p?.on;
    if (on === !!socket.data.camOn) return;
    socket.data.camOn = on;
    if (on) presence.camStarted(actor.playerId!);
    else presence.camStopped(actor.playerId!);
    scheduleBroadcast();
  });

  socket.on('cam:watch', (p: { playerId?: number }) => {
    if (actor.role === 'player' || typeof p?.playerId !== 'number') return;
    const blocked = camAllowed();
    if (blocked) return void socket.emit('cam:error', { playerId: p.playerId, error: blocked });
    const m = currentMission();
    if (m && isInfected(m.id, p.playerId)) return void socket.emit('cam:error', { playerId: p.playerId, error: 'SIGNAL LOST' });
    io!.to(`player:${p.playerId}`).emit('cam:request', { from: socket.id });
  });

  socket.on('cam:signal', (p: { to?: string; data?: unknown }) => {
    if (typeof p?.to !== 'string' || !p.data || JSON.stringify(p.data).length > 20_000) return;
    const target = io!.of('/').sockets.get(p.to);
    const other = target?.data.actor as Actor | undefined;
    if (!target || !other) return;
    if (actor.role === 'player' && other.role !== 'player') {
      const m = currentMission();
      if (m && isInfected(m.id, actor.playerId!)) return;
      target.emit('cam:signal', { from: socket.id, playerId: actor.playerId, data: p.data });
    } else if (actor.role !== 'player' && other.role === 'player') {
      const m = currentMission();
      if (m && isInfected(m.id, other.playerId!)) return;
      target.emit('cam:signal', { from: socket.id, data: p.data });
    }
  });
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
      // Monsters get their own room: crew-wide broadcasts (radio, Company notices, threat warnings) are not for them.
      socket.join([actor.playerRole === 'monster' ? 'monsters' : 'crew', `player:${actor.playerId}`]);
      presence.connected(actor.playerId!);
    } else {
      socket.join(actor.role);
    }
    socket.emit('state', snapshotFor(actor, new Map()));
    socket.on('sync', () => socket.emit('state', snapshotFor(actor, new Map())));
    bindBodyCam(socket, actor);
    socket.on('disconnect', () => {
      if (actor.role === 'player') {
        presence.disconnected(actor.playerId!);
        if (socket.data.camOn) presence.camStopped(actor.playerId!);
      }
      scheduleBroadcast();
    });
    scheduleBroadcast();
  });

  bus.on('changed', scheduleBroadcast);
  bus.on('fx', (f: { name: FxName; payload: FxEvent; target: FxTarget[] }) => emitFx(f.name, f.payload, f.target));
  // Periodic resync so a device that missed a packet converges anyway.
  setInterval(scheduleBroadcast, 15_000);
}
