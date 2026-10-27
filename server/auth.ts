import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, q } from './db.js';
import { GameError, randomToken, type Actor, type PlayerRow } from './game.js';
import type { Role } from '../shared/types.js';

interface Pins { adminPin: string; operatorPin: string; observerPin: string }

function loadPins(): Pins {
  const file = path.join(DATA_DIR, 'secrets.json');
  let pins: Pins;
  if (fs.existsSync(file)) {
    pins = JSON.parse(fs.readFileSync(file, 'utf8')) as Pins;
  } else {
    pins = {
      adminPin: String(crypto.randomInt(100000, 1000000)),
      operatorPin: String(crypto.randomInt(1000, 10000)),
      observerPin: String(crypto.randomInt(100000, 1000000)),
    };
    fs.writeFileSync(file, JSON.stringify(pins, null, 2));
  }
  if (!pins.observerPin) {
    pins.observerPin = String(crypto.randomInt(100000, 1000000));
    fs.writeFileSync(file, JSON.stringify(pins, null, 2));
  }
  return {
    adminPin: process.env.ADMIN_PIN || pins.adminPin,
    operatorPin: process.env.OPERATOR_PIN || pins.operatorPin,
    observerPin: process.env.OBSERVER_PIN || pins.observerPin,
  };
}

export const pins = loadPins();

const attempts = new Map<string, { count: number; reset: number }>();
function throttle(ip: string) {
  const t = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < t) {
    attempts.set(ip, { count: 1, reset: t + 60_000 });
    return;
  }
  if (++a.count > 8) throw new GameError(429, 'Слишком много попыток. Подождите минуту.');
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createSession(role: Role, playerId: number | null) {
  const token = randomToken(24);
  q.run('INSERT INTO sessions (token, role, player_id, created_at) VALUES (?, ?, ?, ?)', token, role, playerId, Date.now());
  return token;
}

export function login(role: unknown, pin: unknown, ip: string) {
  throttle(ip);
  if (role !== 'admin' && role !== 'operator' && role !== 'observer') throw new GameError(400, 'Неизвестная роль');
  const expected = role === 'admin' ? pins.adminPin : role === 'observer' ? pins.observerPin : pins.operatorPin;
  if (typeof pin !== 'string' || !same(pin.trim(), expected)) throw new GameError(401, 'ДОСТУП ЗАПРЕЩЁН: неверный PIN');
  return { token: createSession(role, null), role };
}

export function join(code: unknown, ip: string) {
  throttle(ip);
  const c = typeof code === 'string' ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const p = q.get<PlayerRow>('SELECT * FROM players WHERE join_code = ? AND active = 1', c);
  if (!p) throw new GameError(404, 'Код сотрудника не найден');
  return { token: createSession('player', p.id), role: 'player' as const, playerId: p.id, callsign: p.callsign };
}

export function logout(token: string) {
  q.run('DELETE FROM sessions WHERE token = ?', token);
}

export function actorFor(token: unknown): Actor | null {
  if (typeof token !== 'string' || token.length < 10) return null;
  const s = q.get<{ role: Role; player_id: number | null }>('SELECT role, player_id FROM sessions WHERE token = ?', token);
  if (!s) return null;
  if (s.role === 'player') {
    const p = q.get<PlayerRow>('SELECT * FROM players WHERE id = ? AND active = 1', s.player_id);
    if (!p) return null;
    return { role: 'player', playerId: p.id, label: p.callsign };
  }
  return { role: s.role, playerId: null, label: s.role === 'admin' ? 'FIELD ADMIN' : 'OPERATOR' };
}
