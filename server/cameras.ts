import type { Server, Socket } from 'socket.io';
import { actorFor } from './auth.js';
import { q } from './db.js';
import type { Actor, PlayerRow } from './game.js';

/** Camera signaling is isolated from game state. A viewer has exactly one subscription. */
export function attachCameras(io: Server) {
  const ns = io.of('/cameras');
  const sources = new Map<string, { id: string; playerId: number; callsign: string; role: string }>();
  const watching = new Map<string, string>();
  const actor = (s: Socket) => actorFor(s.handshake.auth?.token);
  const allowed = (a: Actor | null, source: { role: string }) =>
    !!a && (a.role === 'operator' ? source.role === 'crew' :
      (a.role === 'admin' || a.role === 'observer') && source.role === 'monster');
  function stop(viewer: string) {
    const source = watching.get(viewer);
    if (source) ns.to(source).emit('camera:leave', { viewer });
    watching.delete(viewer);
  }
  function removeSource(id: string) {
    sources.delete(id);
    for (const [viewer, source] of watching) if (source === id) {
      stop(viewer);
      ns.to(viewer).emit('camera:ended');
    }
  }
  function refresh() {
    for (const [id, source] of sources) {
      const s = ns.sockets.get(id);
      const a = s && actor(s);
      const p = a?.role === 'player' && q.get<PlayerRow>('SELECT * FROM players WHERE id = ? AND active = 1', a.playerId);
      if (!p) removeSource(id);
      else { source.role = p.role; source.callsign = p.callsign; }
    }
    for (const [viewer, source] of watching) {
      const s = ns.sockets.get(viewer);
      if (!s || !sources.has(source) || !allowed(actor(s), sources.get(source)!)) {
        stop(viewer); ns.to(viewer).emit('camera:ended');
      }
    }
    for (const s of ns.sockets.values()) {
      const a = actor(s);
      if (!a) { s.disconnect(); continue; }
      s.emit('camera:list', [...sources.values()].filter(source => allowed(a, source)));
    }
  }
  ns.use((s, next) => actor(s) ? next() : next(new Error('unauthorized')));
  ns.on('connection', s => {
    s.on('camera:publish', (enabled: unknown) => {
      const a = actor(s);
      if (a?.role !== 'player') return;
      removeSource(s.id);
      const p = q.get<PlayerRow>('SELECT * FROM players WHERE id = ? AND active = 1', a.playerId);
      if (enabled === true && p) {
        // A player's most recently enabled device owns the camera.
        for (const [id, source] of sources) if (source.playerId === p.id) {
          removeSource(id); ns.to(id).emit('camera:replaced');
        }
        sources.set(s.id, { id: s.id, playerId: p.id, callsign: p.callsign, role: p.role });
      }
      refresh();
    });
    s.on('camera:watch', (id: unknown) => {
      stop(s.id);
      const source = typeof id === 'string' && sources.get(id);
      if (!source || !allowed(actor(s), source)) return void s.emit('camera:ended');
      watching.set(s.id, source.id);
      ns.to(source.id).emit('camera:viewer', { viewer: s.id });
    });
    s.on('camera:unwatch', () => stop(s.id));
    s.on('camera:signal', (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const { to, description, candidate } = msg as Record<string, unknown>;
      if (typeof to !== 'string' || JSON.stringify(msg).length > 65536) return;
      const viewer = watching.get(s.id) === to ? s.id : watching.get(to) === s.id ? to : null;
      if (!viewer) return;
      const source = sources.get(watching.get(viewer)!);
      const v = ns.sockets.get(viewer);
      if (!source || !v || !allowed(actor(v), source) || !actor(s)) return;
      ns.to(to).emit('camera:signal', { from: s.id, description, candidate });
    });
    s.on('disconnect', () => { stop(s.id); removeSource(s.id); refresh(); });
    refresh();
  });
  const timer = setInterval(refresh, 3000);
  timer.unref();
  io.engine.on('close', () => clearInterval(timer));
}
