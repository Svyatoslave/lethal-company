import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { io, type Socket } from 'socket.io-client';

test('camera permissions, signaling, switching, reconnect and observer isolation', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'raid-camera-'));
  process.env.DATA_DIR = dir;
  const { db, q } = await import('../server/db.js');
  const { attachRealtime } = await import('../server/realtime.js');
  const { api } = await import('../server/routes.js');
  const sockets: Socket[] = [];
  const app = express();
  app.use(express.json()); app.use('/api', api);
  const server = http.createServer(app);
  attachRealtime(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const wait = <T = any>(socket: Socket, event: string, predicate: (value: T) => boolean = () => true) =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timeout: ${event}`)); }, 4000);
      const listener = (value: T) => { if (predicate(value)) { clearTimeout(timeout); socket.off(event, listener); resolve(value); } };
      socket.on(event, listener);
    });
  async function connect(token: string, namespace = '/cameras') {
    const socket = io(base + namespace, { auth: { token }, transports: ['websocket'], forceNew: true, autoConnect: false });
    sockets.push(socket);
    const ready = wait(socket, 'connect'); socket.connect(); await ready;
    return socket;
  }
  try {
    for (const [id, role] of [[1, 'crew'], [2, 'monster'], [3, 'crew']] as const) {
      q.run('INSERT INTO players (id,callsign,role,join_code,active,created_at) VALUES (?,?,?,?,1,?)', id, `P${id}`, role, `CODE${id}`, Date.now());
      q.run('INSERT INTO sessions (token,role,player_id,created_at) VALUES (?,?,?,?)', `player-token-${id}`, 'player', id, Date.now());
    }
    for (const role of ['operator', 'admin', 'observer']) q.run('INSERT INTO sessions (token,role,player_id,created_at) VALUES (?,?,NULL,?)', `${role}-token-123`, role, Date.now());
    const operator = await connect('operator-token-123');
    const admin = await connect('admin-token-123');
    const observer = await connect('observer-token-123');
    const crew = await connect('player-token-1');
    const monster = await connect('player-token-2');
    const crew2 = await connect('player-token-3');
    let list = wait<any[]>(operator, 'camera:list', x => x.length === 1);
    crew.emit('camera:publish', true);
    assert.equal((await list)[0].playerId, 1);
    const adminList = wait<any[]>(admin, 'camera:list', x => x.length === 1);
    const observerList = wait<any[]>(observer, 'camera:list', x => x.length === 1);
    monster.emit('camera:publish', true);
    assert.equal((await adminList)[0].playerId, 2);
    assert.equal((await observerList)[0].playerId, 2);
    const denied = wait(operator, 'camera:ended');
    operator.emit('camera:watch', monster.id); await denied;
    const deniedCrew = wait(observer, 'camera:ended');
    observer.emit('camera:watch', crew.id); await deniedCrew;
    let joined = wait<{ viewer: string }>(crew, 'camera:viewer');
    operator.emit('camera:watch', crew.id);
    assert.equal((await joined).viewer, operator.id);
    const signal = wait<any>(operator, 'camera:signal');
    crew.emit('camera:signal', { to: operator.id, description: { type: 'offer', sdp: 'test-offer' } });
    assert.equal((await signal).description.sdp, 'test-offer');
    const stopped = wait(crew, 'camera:leave');
    const nextList = wait<any[]>(operator, 'camera:list', x => x.length === 2);
    crew2.emit('camera:publish', true); await nextList;
    joined = wait(crew2, 'camera:viewer');
    operator.emit('camera:watch', crew2.id); await stopped; await joined;
    const ended = wait(operator, 'camera:ended');
    crew2.disconnect(); await ended;
    const newCrew = await connect('player-token-3');
    list = wait<any[]>(operator, 'camera:list', x => x.some(s => s.id === newCrew.id));
    newCrew.emit('camera:publish', true); await list;
    joined = wait(newCrew, 'camera:viewer'); operator.emit('camera:watch', newCrew.id); await joined;
    const forbidden = await fetch(`${base}/api/state`, { headers: { Authorization: 'Bearer observer-token-123' } });
    assert.equal(forbidden.status, 403);
    const mutation = await fetch(`${base}/api/missions/current/pause`, { method: 'POST', headers: { Authorization: 'Bearer observer-token-123' } });
    assert.equal(mutation.status, 403);
    const main = io(base, { autoConnect: false, auth: { token: 'observer-token-123' }, transports: ['websocket'], forceNew: true });
    sockets.push(main);
    const rejected = wait<Error>(main, 'connect_error'); main.connect();
    assert.equal((await rejected).message, 'unauthorized');
  } finally {
    sockets.forEach(s => s.disconnect());
    server.closeAllConnections(); server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
