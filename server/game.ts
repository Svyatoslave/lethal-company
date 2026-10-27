import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { q, tx, kvGet, kvSet } from './db.js';
import type { FxEvent, FxName, Level, MessageTo, MonsterActionType, Role, Visibility, EpStatus } from '../shared/types.js';

// ---------------------------------------------------------------- rows

export interface MissionRow {
  id: number; code: string; name: string; status: string; quota: number; start_balance: number;
  duration_sec: number; overdue_penalty: number; crew_size: number; gate: string; threat_level: number;
  comms_radio: number; comms_disabled: number; message_delay_sec: number; time_bonus_sec: number; cams_unlocked: number;
  overdue_damage: number; monster_damage: number;
  pause_reason: string | null; started_at: number | null; paused_at: number | null; paused_total_ms: number;
  ended_at: number | null; created_at: number;
}
export interface PlayerRow { id: number; callsign: string; role: string; join_code: string; active: number; created_at: number }
export interface ExpeditionRow {
  id: number; mission_id: number; number: number; status: string; duration_sec: number; opened_at: number | null;
  deadline_at: number | null; completed_at: number | null; emergency: number; created_at: number;
}
export interface EpRow {
  id: number; expedition_id: number; player_id: number; status: EpStatus; exit_at: number | null;
  deadline_at: number | null; returned_at: number | null; overdue_at: number | null; penalty_exempt: number;
}
export interface LootRow {
  id: number; mission_id: number; code: string; name: string; description: string; value: number; token: string; status: string;
  found_by: number | null; found_at: number | null; extracted_at: number | null; extract_seq: number; created_at: number;
}
export interface TxRow {
  id: number; mission_id: number; amount: number; kind: string; description: string; ref: string | null;
  idem_key: string | null; reverses_id: number | null; reversed_by_id: number | null; actor: string; created_at: number;
}
export interface ShopRow {
  id: number; mission_id: number; key: string; name: string; description: string; price: number; enabled: number;
  effect_value: number; max_purchases: number; sort: number;
}
export interface PurchaseRow {
  id: number; mission_id: number; item_id: number; price: number; target_player_id: number | null;
  transaction_id: number | null; request_id: string; actor: string; created_at: number;
  fulfilled_at: number | null; fulfillment: string | null;
}

export interface Actor { role: Role; playerId: number | null; label: string; playerRole?: 'crew' | 'monster' }

// ---------------------------------------------------------------- infra

export class GameError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new GameError(status, message);
}

export type FxTarget = 'all' | 'staff' | 'admin' | 'operator' | 'crew' | { playerId: number };

/** Emits 'changed' after every committed mutation and 'fx' for realtime effect events. */
export const bus = new EventEmitter();

let fxQueue: { name: FxName; payload: FxEvent; target: FxTarget[] }[] = [];
let mutateDepth = 0;

function mutate<T>(fn: () => T): T {
  mutateDepth++;
  try {
    const result = tx(fn);
    if (mutateDepth === 1) {
      const queued = fxQueue;
      fxQueue = [];
      bus.emit('changed');
      for (const f of queued) bus.emit('fx', f);
    }
    return result;
  } catch (e) {
    if (mutateDepth === 1) fxQueue = [];
    throw e;
  } finally {
    mutateDepth--;
  }
}

function fx(name: FxName, payload: Omit<FxEvent, 'at'>, ...target: FxTarget[]) {
  fxQueue.push({ name, payload: { ...payload, at: Date.now() }, target: target.length ? target : ['all'] });
}

const now = () => Date.now();
export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function joinCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

function int(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) fail(400, `Некорректное значение: ${name}`);
  return n as number;
}
function text(v: unknown, name: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) fail(400, `Поле «${name}» не заполнено`);
  const s = (v as string).trim();
  if (s.length > max) fail(400, `Поле «${name}» слишком длинное`);
  return s;
}

// ---------------------------------------------------------------- lookups

export function currentMission(): MissionRow | undefined {
  const id = kvGet('current_mission_id');
  return id ? q.get<MissionRow>('SELECT * FROM missions WHERE id = ?', Number(id)) : undefined;
}
function mustMission(): MissionRow {
  return currentMission() ?? fail(409, 'Нет текущей миссии. Создайте миссию в FIELD ADMIN.');
}
function requireRunning(m: MissionRow) {
  if (m.status === 'paused') fail(423, 'ИГРА НА ПАУЗЕ');
  if (m.status !== 'active') fail(409, 'Миссия не запущена');
}
function requireLive(m: MissionRow) {
  if (m.status !== 'active' && m.status !== 'paused') fail(409, 'Миссия не запущена');
}

export function getPlayer(id: number): PlayerRow | undefined {
  return q.get<PlayerRow>('SELECT * FROM players WHERE id = ?', id);
}
function mustPlayer(id: unknown): PlayerRow {
  const p = getPlayer(int(id, 'playerId', 1, 1e9));
  if (!p || !p.active) fail(404, 'Сотрудник не найден');
  return p as PlayerRow;
}

export function balanceOf(missionId: number): number {
  return q.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM transactions WHERE mission_id = ?', missionId)?.s ?? 0;
}
export function quotaProgressOf(missionId: number): number {
  return (
    q.get<{ s: number | null }>("SELECT SUM(value) AS s FROM loot WHERE mission_id = ? AND status = 'extracted'", missionId)?.s ?? 0
  );
}

export function currentExpedition(missionId: number): ExpeditionRow | undefined {
  return q.get<ExpeditionRow>(
    "SELECT * FROM expeditions WHERE mission_id = ? AND status IN ('preparing','active') ORDER BY id DESC LIMIT 1",
    missionId,
  );
}
export function latestExpedition(missionId: number): ExpeditionRow | undefined {
  return (
    currentExpedition(missionId) ??
    q.get<ExpeditionRow>("SELECT * FROM expeditions WHERE mission_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1", missionId)
  );
}
function mustCurrentExpedition(m: MissionRow): ExpeditionRow {
  return currentExpedition(m.id) ?? fail(409, 'Нет текущей вылазки');
}
function epOf(expeditionId: number, playerId: number): EpRow | undefined {
  return q.get<EpRow>('SELECT * FROM expedition_players WHERE expedition_id = ? AND player_id = ?', expeditionId, playerId);
}

// ---------------------------------------------------------------- journal

export function logEvent(
  missionId: number | null, type: string, level: Level, textValue: string,
  visibility: Visibility = 'all', actor = 'SYSTEM',
) {
  q.run(
    'INSERT INTO events (mission_id, type, level, text, visibility, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    missionId, type, level, textValue, visibility, actor, now(),
  );
}

/** Inserts a ledger row. Returns null when the idempotency key was already used (no double effect). */
function addTx(
  missionId: number, amount: number, kind: string, description: string, actor: string,
  idemKey: string | null = null, ref: string | null = null, reversesId: number | null = null,
): number | null {
  const r = q.run(
    `INSERT OR IGNORE INTO transactions (mission_id, amount, kind, description, ref, idem_key, reverses_id, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    missionId, amount, kind, description, ref, idemKey, reversesId, actor, now(),
  );
  if (!r.changes) return null;
  fx('economy:updated', { type: 'economy', level: amount >= 0 ? 'ok' : 'warn', title: `${amount >= 0 ? '+' : ''}${amount} CR`, text: description }, 'staff');
  return r.id;
}

// ---------------------------------------------------------------- missions

const DEFAULT_SHOP = [
  { key: 'radio', name: 'RADIO', price: 150, effect: 0, max: 1,
    description: 'Разблокирует прямую связь оператора с экипажем через устройства.' },
  { key: 'bodycam', name: 'BODY CAM', price: 300, effect: 0, max: 1,
    description: 'Камеры сотрудников: оператор смотрит прямой эфир с телефонов экипажа.' },
  { key: 'medkit', name: 'MEDKIT', price: 100, effect: 50, max: 0,
    description: 'Восстанавливает здоровье выбранного сотрудника (+% HP в параметре эффекта).' },
  { key: 'time_ext', name: 'TIME EXTENSION', price: 200, effect: 300, max: 0,
    description: 'Увеличивает время следующей вылазки (секунды в параметре эффекта).' },
  { key: 'scanner', name: 'THREAT SCANNER', price: 250, effect: 0, max: 0,
    description: 'Запрос подсказки у ведущего: источник угрозы или направление поиска.' },
  { key: 'extraction', name: 'EMERGENCY EXTRACTION', price: 400, effect: 0, max: 0,
    description: 'Даёт ведущему право объявить досрочную эвакуацию без штрафов за опоздание.' },
];

function camsOnlineFx(m: MissionRow, actor: Actor) {
  logEvent(m.id, 'CAM', 'ok', 'Body camera network online. The Company is watching.', 'all', actor.label);
  fx('system:alert', { type: 'cams', level: 'warn', title: 'BODY CAMS ONLINE', text: 'Включите BODY CAM на своём устройстве' });
}

/** Adds any missing default items; existing items (and their edited prices) are left alone. */
function seedShop(missionId: number) {
  DEFAULT_SHOP.forEach((s, i) =>
    q.run(
      `INSERT OR IGNORE INTO shop_items (mission_id, key, name, description, price, effect_value, max_purchases, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      missionId, s.key, s.name, s.description, s.price, s.effect, s.max, i,
    ),
  );
}
// Missions created before an item existed (e.g. BODY CAM) get it on startup.
for (const { id } of q.all<{ id: number }>("SELECT id FROM missions WHERE status <> 'ended'")) seedShop(id);

export interface MissionOpts {
  name?: unknown; quota?: unknown; startBalance?: unknown; durationSec?: unknown;
  overdueDamage?: unknown; monsterDamage?: unknown; crewSize?: unknown; copyLoot?: unknown;
}

export function createMission(o: MissionOpts, actor: Actor) {
  return mutate(() => {
    const prev = currentMission();
    if (prev && prev.status !== 'ended') {
      q.run("UPDATE missions SET status = 'ended', ended_at = ?, gate = 'closed' WHERE id = ?", now(), prev.id);
      logEvent(prev.id, 'SYSTEM', 'warn', `Mission ${prev.code} archived`, 'staff', actor.label);
    }
    const name = o.name === undefined || o.name === '' ? 'NIGHT RAID' : text(o.name, 'Название', 60);
    const quota = o.quota === undefined ? 1000 : int(o.quota, 'Квота', 0, 1e7);
    const startBalance = o.startBalance === undefined ? 0 : int(o.startBalance, 'Стартовый баланс', 0, 1e7);
    const duration = o.durationSec === undefined ? 900 : int(o.durationSec, 'Длительность', 30, 6 * 3600);
    const overdueDamage = o.overdueDamage === undefined ? 50 : int(o.overdueDamage, 'Урон за опоздание', 0, 100);
    const monsterDamage = o.monsterDamage === undefined ? 50 : int(o.monsterDamage, 'Урон монстра', 0, 100);
    const crewSize = o.crewSize === undefined ? 4 : int(o.crewSize, 'Размер группы', 1, 12);
    const code = `LN-${crypto.randomInt(1000, 10000)}`;
    // overdue_penalty (credits) is legacy: lateness now costs HP, so it is stored as 0.
    const id = q.run(
      `INSERT INTO missions (code, name, quota, start_balance, duration_sec, overdue_penalty, overdue_damage, monster_damage, crew_size, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      code, name, quota, startBalance, duration, overdueDamage, monsterDamage, crewSize, now(),
    ).id;
    seedShop(id);
    if (startBalance > 0) addTx(id, startBalance, 'start', 'Стартовый бюджет корпорации', actor.label, `start:${id}`);
    if (o.copyLoot && prev) {
      q.run(
        `INSERT INTO loot (mission_id, code, name, description, value, token, created_at)
         SELECT ?, code, name, description, value, token, ? FROM loot WHERE mission_id = ?`,
        id, now(), prev.id,
      );
    }
    kvSet('current_mission_id', String(id));
    logEvent(id, 'SYSTEM', 'info', `Mission ${code} registered. Quota: ${quota} CR`, 'all', actor.label);
    fx('mission:updated', { type: 'mission', level: 'info', title: `MISSION ${code} REGISTERED` });
    return { id, code };
  });
}

export function startMission(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (m.status !== 'draft') fail(409, 'Миссия уже запущена');
    q.run("UPDATE missions SET status = 'active', started_at = ? WHERE id = ?", now(), m.id);
    logEvent(m.id, 'SYSTEM', 'ok', 'Mission initialized. The Company thanks you for your service.', 'all', actor.label);
    fx('mission:updated', { type: 'mission', level: 'ok', title: 'MISSION INITIALIZED', text: m.code });
  });
}

export function pauseMission(reason: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (m.status === 'paused') return;
    if (m.status !== 'active') fail(409, 'Миссия не запущена');
    const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 120) : 'Экстренная пауза';
    q.run("UPDATE missions SET status = 'paused', paused_at = ?, pause_reason = ? WHERE id = ?", now(), why, m.id);
    logEvent(m.id, 'SYSTEM', 'crit', `ALL OPERATIONS SUSPENDED: ${why}`, 'all', actor.label);
    fx('system:alert', { type: 'pause', level: 'crit', title: 'ИГРА ПРИОСТАНОВЛЕНА', text: why });
  });
}

export function resumeMission(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (m.status !== 'paused' || !m.paused_at) fail(409, 'Игра не на паузе');
    const delta = now() - m.paused_at!;
    // Frozen time is given back to everybody still in the field: deadlines move forward by the pause length.
    q.run(
      `UPDATE expedition_players SET deadline_at = deadline_at + ?
       WHERE deadline_at IS NOT NULL AND status IN ('outside','returning')
         AND expedition_id IN (SELECT id FROM expeditions WHERE mission_id = ? AND status = 'active')`,
      delta, m.id,
    );
    q.run("UPDATE expeditions SET deadline_at = deadline_at + ? WHERE mission_id = ? AND status = 'active' AND deadline_at IS NOT NULL", delta, m.id);
    q.run(
      "UPDATE missions SET status = 'active', paused_at = NULL, pause_reason = NULL, paused_total_ms = paused_total_ms + ? WHERE id = ?",
      delta, m.id,
    );
    logEvent(m.id, 'SYSTEM', 'ok', `Operations resumed after ${Math.round(delta / 1000)}s. Timers restored.`, 'all', actor.label);
    fx('system:alert', { type: 'resume', level: 'ok', title: 'ИГРА ПРОДОЛЖАЕТСЯ' });
  });
}

export function endMission(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (m.status === 'ended') return;
    const t = now();
    const extraPause = m.status === 'paused' && m.paused_at ? t - m.paused_at : 0;
    q.run(
      "UPDATE missions SET status = 'ended', ended_at = ?, paused_at = NULL, paused_total_ms = paused_total_ms + ?, gate = 'closed' WHERE id = ?",
      t, extraPause, m.id,
    );
    const progress = quotaProgressOf(m.id);
    const verdict = progress >= m.quota ? 'QUOTA FULFILLED. The Company is pleased.' : 'QUOTA NOT MET. The Company will remember this.';
    logEvent(m.id, 'SYSTEM', progress >= m.quota ? 'ok' : 'crit', `Mission terminated. Scrap: ${progress}/${m.quota} CR. ${verdict}`, 'all', actor.label);
    fx('mission:updated', { type: 'end', level: progress >= m.quota ? 'ok' : 'crit', title: 'MISSION TERMINATED', text: verdict });
  });
}

export function updateMission(patch: Record<string, unknown>, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const sets: [string, string | number][] = [];
    if (patch.name !== undefined) sets.push(['name', text(patch.name, 'Название', 60)]);
    if (patch.quota !== undefined) sets.push(['quota', int(patch.quota, 'Квота', 0, 1e7)]);
    if (patch.durationSec !== undefined) sets.push(['duration_sec', int(patch.durationSec, 'Длительность', 30, 6 * 3600)]);
    if (patch.overdueDamage !== undefined) sets.push(['overdue_damage', int(patch.overdueDamage, 'Урон за опоздание', 0, 100)]);
    if (patch.monsterDamage !== undefined) sets.push(['monster_damage', int(patch.monsterDamage, 'Урон монстра', 0, 100)]);
    if (patch.crewSize !== undefined) sets.push(['crew_size', int(patch.crewSize, 'Размер группы', 1, 12)]);
    if (patch.messageDelaySec !== undefined) sets.push(['message_delay_sec', int(patch.messageDelaySec, 'Задержка', 0, 600)]);
    if (patch.timeBonusSec !== undefined) sets.push(['time_bonus_sec', int(patch.timeBonusSec, 'Бонус времени', 0, 6 * 3600)]);
    if (patch.commsDisabled !== undefined) sets.push(['comms_disabled', patch.commsDisabled ? 1 : 0]);
    if (patch.commsRadio !== undefined) sets.push(['comms_radio', patch.commsRadio ? 1 : 0]);
    if (patch.camsUnlocked !== undefined) sets.push(['cams_unlocked', patch.camsUnlocked ? 1 : 0]);
    if (!sets.length) return;
    q.run(`UPDATE missions SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), m.id);
    logEvent(m.id, 'ADMIN', 'info', `Settings changed: ${sets.map(([k, v]) => `${k}=${v}`).join(', ')}`, 'admin', actor.label);
    if (patch.commsDisabled !== undefined && !!patch.commsDisabled !== !!m.comms_disabled) {
      logEvent(m.id, 'COMMS', patch.commsDisabled ? 'crit' : 'ok',
        patch.commsDisabled ? 'Signal lost. Radio link interrupted.' : 'Signal restored.', 'all', actor.label);
      fx('system:alert', { type: 'comms', level: patch.commsDisabled ? 'warn' : 'ok', title: patch.commsDisabled ? 'SIGNAL LOST' : 'SIGNAL RESTORED' });
    }
    if (patch.camsUnlocked && !m.cams_unlocked) camsOnlineFx(m, actor);
    if (patch.monsterDamage !== undefined && Number(patch.monsterDamage) !== m.monster_damage) {
      const d = Number(patch.monsterDamage);
      const rage = d >= 100;
      // Everyone must know when monsters become lethal: a loud alert on every device, crew included.
      logEvent(m.id, 'THREAT', rage ? 'crit' : 'warn',
        rage ? 'ENTITIES ENRAGED. A single contact is now lethal (−100% HP).' : `Entity aggression changed: a contact costs ${d}% HP.`, 'all', actor.label);
      fx('system:alert', {
        type: 'rage', level: rage ? 'crit' : 'warn',
        title: rage ? 'МОНСТРЫ В ЯРОСТИ' : `УРОН МОНСТРОВ: ${d}%`,
        text: rage ? 'Один удар — 100% здоровья. Будьте предельно осторожны.' : `Один удар отнимает ${d}% здоровья.`,
      });
    }
    if (patch.commsRadio && !m.comms_radio) {
      logEvent(m.id, 'COMMS', 'ok', 'Signal established. Direct radio link online.', 'all', actor.label);
      fx('comms:unlocked', { type: 'comms', level: 'ok', title: 'SIGNAL ESTABLISHED', text: 'Прямая связь доступна' });
    }
  });
}

// ---------------------------------------------------------------- players

export function addPlayer(callsign: unknown, role: unknown, actor: Actor) {
  return mutate(() => {
    const name = text(callsign, 'Позывной', 24).toUpperCase();
    const r = role === 'monster' ? 'monster' : 'crew';
    let code = joinCode();
    while (q.get('SELECT 1 FROM players WHERE join_code = ?', code)) code = joinCode();
    const id = q.run('INSERT INTO players (callsign, role, join_code, created_at) VALUES (?, ?, ?, ?)', name, r, code, now()).id;
    logEvent(currentMission()?.id ?? null, 'CREW', 'info', `Personnel file created: ${name} (${r})`, 'staff', actor.label);
    return { id, joinCode: code };
  });
}

export function updatePlayer(id: unknown, patch: Record<string, unknown>, actor: Actor) {
  return mutate(() => {
    const p = mustPlayer(id);
    if (patch.callsign !== undefined) q.run('UPDATE players SET callsign = ? WHERE id = ?', text(patch.callsign, 'Позывной', 24).toUpperCase(), p.id);
    if (patch.role !== undefined) q.run('UPDATE players SET role = ? WHERE id = ?', patch.role === 'monster' ? 'monster' : 'crew', p.id);
    if (patch.regenerateCode) {
      let code = joinCode();
      while (q.get('SELECT 1 FROM players WHERE join_code = ?', code)) code = joinCode();
      q.run('UPDATE players SET join_code = ? WHERE id = ?', code, p.id);
      q.run('DELETE FROM sessions WHERE player_id = ?', p.id);
    }
    logEvent(currentMission()?.id ?? null, 'ADMIN', 'info', `Personnel file updated: ${p.callsign}`, 'admin', actor.label);
  });
}

export function removePlayer(id: unknown, actor: Actor) {
  return mutate(() => {
    const p = mustPlayer(id);
    const busy = q.get(
      `SELECT 1 FROM expedition_players ep JOIN expeditions e ON e.id = ep.expedition_id
       WHERE ep.player_id = ? AND e.status IN ('preparing','active') AND ep.status <> 'returned'`, p.id,
    );
    if (busy) fail(409, 'Сотрудник участвует в текущей вылазке');
    q.run('UPDATE players SET active = 0 WHERE id = ?', p.id);
    q.run('DELETE FROM sessions WHERE player_id = ?', p.id);
    logEvent(currentMission()?.id ?? null, 'CREW', 'warn', `Personnel file archived: ${p.callsign}`, 'staff', actor.label);
  });
}

// ---------------------------------------------------------------- expeditions & gate

function rosterNames(expeditionId: number) {
  return q.all<{ callsign: string }>(
    'SELECT p.callsign FROM expedition_players ep JOIN players p ON p.id = ep.player_id WHERE ep.expedition_id = ? ORDER BY ep.id',
    expeditionId,
  ).map((r) => r.callsign);
}

function validateCrewMember(m: MissionRow, playerId: unknown, expeditionId: number | null): PlayerRow {
  const p = mustPlayer(playerId);
  if (p.role !== 'crew') fail(409, `${p.callsign} не является сотрудником экипажа`);
  const busy = q.get(
    `SELECT 1 FROM expedition_players ep JOIN expeditions e ON e.id = ep.expedition_id
     WHERE ep.player_id = ? AND e.mission_id = ? AND e.status IN ('preparing','active') AND e.id <> ? AND ep.status <> 'returned'`,
    p.id, m.id, expeditionId ?? -1,
  );
  if (busy) fail(409, `${p.callsign} уже в другой вылазке`);
  return p;
}

export function formExpedition(playerIds: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireLive(m);
    if (!Array.isArray(playerIds)) fail(400, 'Не выбраны сотрудники');
    const ids = [...new Set(playerIds as unknown[])];
    if (ids.length < 1 || ids.length > m.crew_size) fail(400, `Выберите от 1 до ${m.crew_size} сотрудников`);
    let exp = currentExpedition(m.id);
    if (exp?.status === 'active') fail(409, 'Вылазка уже идёт. Дождитесь возвращения экипажа.');
    const players = ids.map((id) => validateCrewMember(m, id, exp?.id ?? null));
    if (exp) {
      q.run('DELETE FROM expedition_players WHERE expedition_id = ?', exp.id);
    } else {
      const n = (q.get<{ c: number }>("SELECT COUNT(*) AS c FROM expeditions WHERE mission_id = ? AND status <> 'cancelled'", m.id)?.c ?? 0) + 1;
      const id = q.run(
        'INSERT INTO expeditions (mission_id, number, duration_sec, created_at) VALUES (?, ?, ?, ?)', m.id, n, m.duration_sec, now(),
      ).id;
      exp = q.get<ExpeditionRow>('SELECT * FROM expeditions WHERE id = ?', id)!;
    }
    for (const p of players) q.run('INSERT INTO expedition_players (expedition_id, player_id) VALUES (?, ?)', exp.id, p.id);
    logEvent(m.id, 'CREW', 'info', `Expedition #${exp.number} roster: ${players.map((p) => p.callsign).join(', ')}`, 'all', actor.label);
    return { id: exp.id };
  });
}

export function addToExpedition(playerId: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireLive(m);
    const exp = mustCurrentExpedition(m);
    const count = q.get<{ c: number }>('SELECT COUNT(*) AS c FROM expedition_players WHERE expedition_id = ?', exp.id)!.c;
    if (count >= m.crew_size) fail(409, `В группе максимум ${m.crew_size} сотрудников`);
    const p = validateCrewMember(m, playerId, exp.id);
    if (epOf(exp.id, p.id)) fail(409, `${p.callsign} уже в группе`);
    q.run('INSERT INTO expedition_players (expedition_id, player_id) VALUES (?, ?)', exp.id, p.id);
    logEvent(m.id, 'CREW', 'info', `${p.callsign} assigned to expedition #${exp.number}`, 'staff', actor.label);
  });
}

export function removeFromExpedition(playerId: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const exp = mustCurrentExpedition(m);
    const p = mustPlayer(playerId);
    const ep = epOf(exp.id, p.id) ?? fail(404, 'Сотрудник не в группе');
    if (ep.status !== 'ready') fail(409, 'Сотрудник уже вышел за шлюз');
    q.run('DELETE FROM expedition_players WHERE id = ?', ep.id);
    logEvent(m.id, 'CREW', 'info', `${p.callsign} removed from expedition #${exp.number}`, 'staff', actor.label);
    const left = q.get<{ c: number }>('SELECT COUNT(*) AS c FROM expedition_players WHERE expedition_id = ?', exp.id)!.c;
    if (!left && exp.status === 'preparing') q.run("UPDATE expeditions SET status = 'cancelled' WHERE id = ?", exp.id);
    else maybeCompleteExpedition(m, exp.id, actor);
  });
}

function sendOut(m: MissionRow, exp: ExpeditionRow, ep: EpRow, at: number, actor: Actor) {
  const deadline = at + exp.duration_sec * 1000;
  q.run("UPDATE expedition_players SET status = 'outside', exit_at = ?, deadline_at = ? WHERE id = ?", at, deadline, ep.id);
  const p = getPlayer(ep.player_id)!;
  logEvent(m.id, 'CREW', 'info', `${p.callsign} entered the field`, 'all', actor.label);
}

export function openGate(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireRunning(m);
    const t = now();
    let exp = currentExpedition(m.id);
    if (exp?.status === 'preparing') {
      const duration = m.duration_sec + m.time_bonus_sec;
      q.run("UPDATE expeditions SET status = 'active', opened_at = ?, deadline_at = ?, duration_sec = ? WHERE id = ?", t, t + duration * 1000, duration, exp.id);
      if (m.time_bonus_sec) {
        q.run('UPDATE missions SET time_bonus_sec = 0 WHERE id = ?', m.id);
        logEvent(m.id, 'STORE', 'ok', `Time extension applied: +${Math.round(m.time_bonus_sec / 60)} min`, 'all', actor.label);
      }
      exp = q.get<ExpeditionRow>('SELECT * FROM expeditions WHERE id = ?', exp.id)!;
    }
    const wasOpen = m.gate === 'open';
    q.run("UPDATE missions SET gate = 'open' WHERE id = ?", m.id);
    if (!wasOpen) {
      logEvent(m.id, 'GATE', 'warn', 'Airlock opened', 'all', actor.label);
      fx('gate:opened', { type: 'gate', level: 'warn', title: 'AIRLOCK OPEN', text: exp ? `Вылазка #${exp.number}` : undefined });
    }
    if (exp?.status === 'active') {
      const ready = q.all<EpRow>("SELECT * FROM expedition_players WHERE expedition_id = ? AND status = 'ready'", exp.id);
      for (const ep of ready) sendOut(m, exp, ep, t, actor);
    }
  });
}

export function gateClosing(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireLive(m);
    if (m.gate === 'closed') fail(409, 'Шлюз уже закрыт');
    q.run("UPDATE missions SET gate = 'closing' WHERE id = ?", m.id);
    logEvent(m.id, 'GATE', 'crit', 'WARNING: GATE CLOSING. All personnel return to base.', 'all', actor.label);
    fx('gate:closing', { type: 'gate', level: 'crit', title: 'GATE CLOSING', text: 'Возвращайтесь на базу. Шагом.' });
  });
}

export function closeGate(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (m.gate === 'closed') return;
    q.run("UPDATE missions SET gate = 'closed' WHERE id = ?", m.id);
    logEvent(m.id, 'GATE', 'info', 'Airlock sealed', 'all', actor.label);
    fx('gate:closed', { type: 'gate', level: 'info', title: 'AIRLOCK SEALED' });
  });
}

export function markExit(playerId: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireRunning(m);
    const exp = mustCurrentExpedition(m);
    if (exp.status !== 'active') fail(409, 'Сначала откройте шлюз');
    const p = mustPlayer(playerId);
    const ep = epOf(exp.id, p.id) ?? fail(404, 'Сотрудник не в группе');
    if (ep.status !== 'ready') fail(409, 'Сотрудник уже за шлюзом');
    sendOut(m, exp, ep, now(), actor);
  });
}

export function markReturning(playerId: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const exp = mustCurrentExpedition(m);
    const p = mustPlayer(playerId);
    const ep = epOf(exp.id, p.id) ?? fail(404, 'Сотрудник не в группе');
    if (ep.status === 'returning' || ep.status === 'overdue') return;
    if (ep.status !== 'outside') fail(409, 'Сотрудник не за шлюзом');
    q.run("UPDATE expedition_players SET status = 'returning' WHERE id = ?", ep.id);
    logEvent(m.id, 'CREW', 'info', `${p.callsign} is heading back to base`, 'all', actor.label);
  });
}

function maybeCompleteExpedition(m: MissionRow, expeditionId: number, actor: Actor) {
  const exp = q.get<ExpeditionRow>('SELECT * FROM expeditions WHERE id = ?', expeditionId)!;
  if (exp.status !== 'active') return;
  const out = q.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM expedition_players WHERE expedition_id = ? AND status IN ('outside','returning','overdue')", exp.id,
  )!.c;
  const exited = q.get<{ c: number }>('SELECT COUNT(*) AS c FROM expedition_players WHERE expedition_id = ? AND exit_at IS NOT NULL', exp.id)!.c;
  if (out > 0 || exited === 0) return;
  q.run("DELETE FROM expedition_players WHERE expedition_id = ? AND status = 'ready'", exp.id);
  q.run("UPDATE expeditions SET status = 'completed', completed_at = ? WHERE id = ?", now(), exp.id);
  logEvent(m.id, 'SYSTEM', 'ok', `Expedition #${exp.number} complete. All personnel accounted for.`, 'all', actor.label);
  fx('mission:updated', { type: 'expedition', level: 'ok', title: `EXPEDITION #${exp.number} COMPLETE`, text: 'Весь экипаж на базе' });
}

export function confirmReturn(playerId: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const exp = mustCurrentExpedition(m);
    const p = mustPlayer(playerId);
    const ep = epOf(exp.id, p.id) ?? fail(404, 'Сотрудник не в группе');
    if (ep.status === 'returned') return { already: true };
    if (ep.status === 'ready') fail(409, 'Сотрудник не выходил за шлюз');
    q.run("UPDATE expedition_players SET status = 'returned', returned_at = ? WHERE id = ?", now(), ep.id);
    logEvent(m.id, 'CREW', ep.status === 'overdue' ? 'warn' : 'ok',
      `${p.callsign} returned to base${ep.status === 'overdue' ? ' (LATE)' : ''} — confirmed by ${actor.label}`, 'all', actor.label);
    maybeCompleteExpedition(m, exp.id, actor);
    return { already: false };
  });
}

const EP_STATUSES: EpStatus[] = ['ready', 'outside', 'returning', 'overdue', 'returned'];

export function correctStatus(playerId: unknown, status: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const exp = mustCurrentExpedition(m);
    const p = mustPlayer(playerId);
    const ep = epOf(exp.id, p.id) ?? fail(404, 'Сотрудник не в группе');
    if (!EP_STATUSES.includes(status as EpStatus)) fail(400, 'Неизвестный статус');
    const s = status as EpStatus;
    const t = now();
    if (s === 'ready') {
      q.run("UPDATE expedition_players SET status = 'ready', exit_at = NULL, deadline_at = NULL, returned_at = NULL, overdue_at = NULL WHERE id = ?", ep.id);
    } else if (s === 'outside' || s === 'returning') {
      if (exp.status !== 'active') fail(409, 'Шлюз ещё не открывался для этой вылазки');
      const exitAt = ep.exit_at ?? t;
      const deadline = ep.deadline_at && ep.deadline_at > t ? ep.deadline_at : t + exp.duration_sec * 1000;
      q.run('UPDATE expedition_players SET status = ?, exit_at = ?, deadline_at = ?, returned_at = NULL WHERE id = ?', s, exitAt, deadline, ep.id);
    } else if (s === 'overdue') {
      q.run("UPDATE expedition_players SET status = 'overdue', overdue_at = ?, returned_at = NULL WHERE id = ?", ep.overdue_at ?? t, ep.id);
    } else {
      q.run("UPDATE expedition_players SET status = 'returned', returned_at = ? WHERE id = ?", t, ep.id);
    }
    logEvent(m.id, 'ADMIN', 'warn', `Status corrected: ${p.callsign} ${ep.status.toUpperCase()} → ${s.toUpperCase()}`, 'staff', actor.label);
    maybeCompleteExpedition(m, exp.id, actor);
  });
}

export function forceCompleteExpedition(actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const exp = mustCurrentExpedition(m);
    if (exp.status === 'preparing') {
      q.run("UPDATE expeditions SET status = 'cancelled' WHERE id = ?", exp.id);
      logEvent(m.id, 'ADMIN', 'warn', `Expedition #${exp.number} cancelled`, 'all', actor.label);
      return;
    }
    q.run("UPDATE expedition_players SET status = 'returned', returned_at = ? WHERE expedition_id = ? AND status IN ('outside','returning','overdue')", now(), exp.id);
    q.run("UPDATE expedition_players SET exit_at = COALESCE(exit_at, ?) WHERE expedition_id = ?", now(), exp.id);
    logEvent(m.id, 'ADMIN', 'warn', `Expedition #${exp.number} closed manually by ${actor.label}`, 'all', actor.label);
    maybeCompleteExpedition(m, exp.id, actor);
  });
}

// ---------------------------------------------------------------- health

export function hpOf(missionId: number, playerId: number): number {
  return q.get<{ hp: number }>('SELECT hp FROM health WHERE mission_id = ? AND player_id = ?', missionId, playerId)?.hp ?? 100;
}

/**
 * Changes a player's HP (clamped to 0..100) and records it. HP never regenerates by itself: only
 * MEDKIT and admin corrections raise it. Returns null when the idempotency key was already used.
 */
function changeHp(
  m: MissionRow, playerId: number, delta: number, kind: 'overdue' | 'hit' | 'medkit' | 'admin', reason: string, actor: string,
  idemKey: string | null = null,
): { before: number; after: number } | null {
  const before = hpOf(m.id, playerId);
  const after = Math.max(0, Math.min(100, before + delta));
  const r = q.run(
    `INSERT OR IGNORE INTO health_events (mission_id, player_id, delta, hp_after, kind, reason, actor, idem_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, playerId, after - before, after, kind, reason, actor, idemKey, now(),
  );
  if (!r.changes) return null;
  q.run(
    'INSERT INTO health (mission_id, player_id, hp) VALUES (?, ?, ?) ON CONFLICT(mission_id, player_id) DO UPDATE SET hp = excluded.hp',
    m.id, playerId, after,
  );
  if (after === 0 && before > 0) {
    const p = getPlayer(playerId)!;
    logEvent(m.id, 'WARNING', 'crit', `${p.callsign} is DOWN. Vital signs critical.`, 'all');
    fx('system:alert', { type: 'down', level: 'crit', title: `${p.callsign}: HP 0%`, text: 'Сотрудник выведен из строя. Нужна аптечка.', targetPlayerId: playerId });
  }
  return { before, after };
}

const inField = (m: MissionRow, playerId: number) =>
  !!q.get(
    `SELECT 1 FROM expedition_players ep JOIN expeditions e ON e.id = ep.expedition_id
     WHERE e.mission_id = ? AND e.status = 'active' AND ep.player_id = ? AND ep.status IN ('outside','returning','overdue')`,
    m.id, playerId,
  );

const lastHit = new Map<string, number>();
const HIT_COOLDOWN_MS = 10_000;

/** A monster reports that it touched/tagged a crew member. Damage is the mission's monster_damage percent. */
export function monsterHit(o: { targetPlayerId?: unknown; requestId?: unknown }, actor: Actor) {
  return mutate(() => {
    if (actor.role !== 'player' || actor.playerRole !== 'monster') fail(403, 'Отмечать удары может только монстр');
    const m = mustMission();
    requireRunning(m);
    if (typeof o.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(o.requestId)) fail(400, 'Нет идентификатора запроса');
    const target = mustPlayer(o.targetPlayerId);
    if (target.role !== 'crew') fail(409, 'Цель не является сотрудником экипажа');
    if (!inField(m, target.id)) fail(409, `${target.callsign} не за шлюзом`);
    // Different request ids for the same target within seconds are almost always a double tap.
    const pair = `${actor.playerId}:${target.id}`;
    const dup = q.get('SELECT 1 FROM health_events WHERE idem_key = ?', `hit:${o.requestId}`);
    if (!dup && (lastHit.get(pair) ?? 0) > now() - HIT_COOLDOWN_MS) fail(429, 'Удар по этой цели уже отмечен. Подождите 10 секунд.');
    // The reason is shown to the victim; who hit is kept in `actor` (admin-only views).
    const r = changeHp(m, target.id, -m.monster_damage, 'hit', 'Атака монстра', actor.label, `hit:${o.requestId}`);
    if (!r) return { duplicate: true, hp: hpOf(m.id, target.id) };
    lastHit.set(pair, now());
    logEvent(m.id, 'THREAT', 'crit', `Hostile contact: ${target.callsign} injured (HP ${r.after}%)`, 'all', actor.label);
    logEvent(m.id, 'THREAT', 'info', `↳ hit by ${actor.label}, −${m.monster_damage}%`, 'admin', actor.label);
    fx('monster:event', { type: 'hit', level: 'crit', title: 'ВЫ РАНЕНЫ', text: `Здоровье: ${r.after}%`, targetPlayerId: target.id }, { playerId: target.id });
    fx('monster:event', { type: 'hit', level: 'warn', title: `${target.callsign} РАНЕН`, text: `HP ${r.after}%` }, 'operator');
    fx('monster:event', { type: 'hit', level: 'warn', title: `${target.callsign} РАНЕН`, text: `HP ${r.after}% · ${actor.label}` }, 'admin');
    return { duplicate: false, hp: r.after };
  });
}

/** Field admin correction: sets HP to an exact value (recorded as an 'admin' health event). */
export function setHp(playerId: unknown, hp: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const p = mustPlayer(playerId);
    const value = int(hp, 'HP', 0, 100);
    const r = changeHp(m, p.id, value - hpOf(m.id, p.id), 'admin', 'Корректировка ведущим', actor.label);
    logEvent(m.id, 'ADMIN', 'warn', `HP corrected: ${p.callsign} ${r?.before}% → ${value}%`, 'staff', actor.label);
  });
}


// ---------------------------------------------------------------- tick

let lastDeliveryCheck = Date.now();

/** Called every second: overdue detection and delayed message delivery. Server is the only clock. */
export function tick() {
  const m = currentMission();
  if (!m) return;
  const t = now();
  if (m.status === 'active') {
    const due = q.all<EpRow & { callsign: string; number: number }>(
      `SELECT ep.*, p.callsign, e.number FROM expedition_players ep
       JOIN expeditions e ON e.id = ep.expedition_id JOIN players p ON p.id = ep.player_id
       WHERE e.mission_id = ? AND e.status = 'active' AND ep.status IN ('outside','returning')
         AND ep.penalty_exempt = 0 AND ep.deadline_at IS NOT NULL AND ep.deadline_at <= ?`,
      m.id, t,
    );
    for (const ep of due) {
      mutate(() => {
        const r = q.run("UPDATE expedition_players SET status = 'overdue', overdue_at = ? WHERE id = ? AND status IN ('outside','returning')", t, ep.id);
        if (!r.changes) return;
        const hp = changeHp(m, ep.player_id, -m.overdue_damage, 'overdue', `Опоздание, вылазка #${ep.number}`, 'SYSTEM', `overdue:${ep.id}`);
        const left = hp?.after ?? hpOf(m.id, ep.player_id);
        logEvent(m.id, 'WARNING', 'crit', `Crew member overdue: ${ep.callsign} (HP ${left}%)`, 'all');
        fx('player:overdue', { type: 'overdue', level: 'crit', title: `${ep.callsign}: OVERDUE`, text: `Срок возвращения истёк. Здоровье: ${left}%`, targetPlayerId: ep.player_id });
      });
    }
  }
  // Only delayed transmissions: instant ones were already announced by insertMessage.
  const delivered = q.all<{ to_type: MessageTo; to_player_id: number | null; channel: string; body: string; from_role: Role; cs: string | null }>(
    `SELECT msg.to_type, msg.to_player_id, msg.channel, msg.body, msg.from_role, p.callsign AS cs
     FROM messages msg LEFT JOIN players p ON p.id = msg.from_player_id
     WHERE msg.mission_id = ? AND msg.deliver_at > msg.created_at AND msg.deliver_at > ? AND msg.deliver_at <= ?`,
    m.id, lastDeliveryCheck, t,
  );
  lastDeliveryCheck = t;
  if (delivered.length) {
    for (const msg of delivered) {
      bus.emit('fx', messageFx(msg.to_type, msg.to_player_id, senderLabel(msg.from_role, msg.channel, msg.cs), msg.body));
    }
    bus.emit('changed');
  }
}

function messageTargets(toType: MessageTo, toPlayerId: number | null): FxTarget[] {
  if (toType === 'operator') return ['operator', 'admin'];
  if (toType === 'admin') return ['admin'];
  if (toType === 'crew') return ['crew', 'staff'];
  return toPlayerId ? [{ playerId: toPlayerId }, 'staff'] : ['staff'];
}
function senderLabel(role: Role, channel: string, callsign: string | null) {
  if (role === 'player') return callsign ?? 'CREW';
  if (role === 'operator') return 'OPERATOR';
  return channel === 'system' ? 'COMPANY' : 'FIELD ADMIN';
}
function messageFx(toType: MessageTo, toPlayerId: number | null, from: string, body: string) {
  return {
    name: 'message:received' as FxName,
    payload: {
      type: 'message', level: 'info' as Level, title: `INCOMING TRANSMISSION · ${from}`,
      text: body.length > 140 ? `${body.slice(0, 140)}…` : body, targetPlayerId: toPlayerId, at: now(),
    },
    target: messageTargets(toType, toPlayerId),
  };
}

// ---------------------------------------------------------------- loot

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

export function claimLoot(token: unknown, actor: Actor) {
  return mutate(() => {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) fail(400, 'СИГНАТУРА НЕ РАСПОЗНАНА');
    const m = mustMission();
    requireRunning(m);
    // House rule: scrap is registered between raids, never while a group is in the field.
    if (currentExpedition(m.id)?.status === 'active') fail(423, 'СКАНИРОВАНИЕ ЗАБЛОКИРОВАНО ВО ВРЕМЯ ВЫЛАЗКИ');
    const item = q.get<LootRow>('SELECT * FROM loot WHERE mission_id = ? AND token = ?', m.id, token as string);
    if (!item) {
      const elsewhere = q.get('SELECT 1 FROM loot WHERE token = ?', token as string);
      fail(404, elsewhere ? 'ОБЪЕКТ НЕ ОТНОСИТСЯ К ТЕКУЩЕЙ МИССИИ' : 'СИГНАТУРА НЕ РАСПОЗНАНА');
    }
    const t = now();
    const r = q.run("UPDATE loot SET status = 'found', found_by = ?, found_at = ? WHERE id = ? AND status = 'available'", actor.playerId, t, item!.id);
    const fresh = q.get<LootRow>('SELECT * FROM loot WHERE id = ?', item!.id)!;
    if (r.changes) {
      logEvent(m.id, 'SCRAP', 'info', `Object detected: ${fresh.name} [${fresh.code}] — ${actor.label}`, 'all', actor.label);
      fx('loot:found', { type: 'loot', level: 'info', title: 'SCRAP DETECTED', text: `${fresh.name} [${fresh.code}] — ${actor.label}` }, 'staff');
    }
    const finder = fresh.found_by ? getPlayer(fresh.found_by)?.callsign ?? null : null;
    return {
      result: r.changes ? 'identified' : 'duplicate',
      item: {
        code: fresh.code, name: fresh.name, description: fresh.description, value: fresh.value,
        status: fresh.status, foundBy: finder, foundAt: fresh.found_at,
      },
    };
  });
}

function mustLoot(m: MissionRow, id: unknown): LootRow {
  return q.get<LootRow>('SELECT * FROM loot WHERE id = ? AND mission_id = ?', int(id, 'lootId', 1, 1e9), m.id) ?? fail(404, 'Предмет не найден');
}

export function extractLoot(id: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireLive(m);
    const item = mustLoot(m, id);
    if (item.status === 'extracted') return { already: true };
    const before = quotaProgressOf(m.id);
    q.run("UPDATE loot SET status = 'extracted', extracted_at = ? WHERE id = ? AND status <> 'extracted'", now(), item.id);
    addTx(m.id, item.value, 'loot', `Scrap extracted: ${item.name} [${item.code}]`, actor.label, `loot:${item.id}:${item.extract_seq}`, `loot:${item.id}`);
    logEvent(m.id, 'SCRAP', 'ok', `${item.name} [${item.code}] delivered to base: +${item.value} CR`, 'all', actor.label);
    fx('loot:extracted', { type: 'loot', level: 'ok', title: `+${item.value} CR`, text: `${item.name} доставлен на базу` });
    const after = before + item.value;
    if (before < m.quota && after >= m.quota) {
      logEvent(m.id, 'SYSTEM', 'ok', `QUOTA REACHED: ${after}/${m.quota} CR. The Company acknowledges your productivity.`, 'all', 'SYSTEM');
      fx('system:alert', { type: 'quota', level: 'ok', title: 'QUOTA REACHED', text: `${after} / ${m.quota} CR` });
    }
    return { already: false };
  });
}

function undoExtractionInner(m: MissionRow, item: LootRow, reason: string, actor: Actor) {
  if (item.status !== 'extracted') fail(409, 'Предмет не извлечён');
  const orig = q.get<TxRow>('SELECT * FROM transactions WHERE idem_key = ?', `loot:${item.id}:${item.extract_seq}`);
  q.run('UPDATE loot SET status = ?, extracted_at = NULL, extract_seq = extract_seq + 1 WHERE id = ?', item.found_by ? 'found' : 'available', item.id);
  if (orig && !orig.reversed_by_id) {
    const cid = addTx(m.id, -orig.amount, 'correction', `Корректировка: ${reason} (${item.code})`, actor.label, `reverse:${orig.id}`, `loot:${item.id}`, orig.id);
    q.run('UPDATE transactions SET reversed_by_id = ? WHERE id = ?', cid, orig.id);
  }
  logEvent(m.id, 'ADMIN', 'warn', `Extraction reverted: ${item.name} [${item.code}]`, 'staff', actor.label);
}

export function undoExtraction(id: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    undoExtractionInner(m, mustLoot(m, id), 'отмена извлечения', actor);
  });
}

export function resetLoot(id: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const item = mustLoot(m, id);
    if (item.status === 'extracted') fail(409, 'Сначала отмените извлечение');
    q.run("UPDATE loot SET status = 'available', found_by = NULL, found_at = NULL WHERE id = ?", item.id);
    logEvent(m.id, 'ADMIN', 'warn', `Scan record cleared: ${item.name} [${item.code}]`, 'staff', actor.label);
  });
}

const SCRAP_POOL: [string, string][] = [
  ['Медная катушка', 'Тёплая на ощупь. Внутри что-то тихо гудит.'],
  ['Ржавая шестерня', 'Зубцы стёрты. Похоже, механизм крутили очень долго.'],
  ['Резиновая утка', 'Пищит, если на неё не смотреть.'],
  ['Старый чайник', 'Накипь внутри складывается в чьё-то лицо.'],
  ['Кассета без подписи', 'На плёнке — 40 минут чьего-то дыхания.'],
  ['Банка с неизвестной жидкостью', 'Не открывать. Не нюхать. Не трясти.'],
  ['Сломанный фонарь', 'Иногда мигает сам. Батареек внутри нет.'],
  ['Зубной протез', 'Ценный экспонат. Владелец пока не объявился.'],
  ['Колокольчик', 'Звенит без ветра. Отдел кадров просит его не трогать.'],
  ['Кукольная голова', 'Глаза закрываются, когда вы отворачиваетесь.'],
  ['Аккумулятор', 'Заряд 3%. Компании хватит.'],
  ['Трубка телефона', 'Если поднести к уху, слышно гудок. Провода нет.'],
  ['Золотистый кубок', '«За выдающуюся лояльность». Имя соскоблено.'],
  ['Магнитола', 'Ловит одну станцию. Там читают ваши имена.'],
  ['Подкова', 'Приносит удачу. Предыдущему владельцу не принесла.'],
  ['Противогаз', 'Стёкла запотели изнутри.'],
  ['Пластиковый фламинго', 'Стоит на одной ноге уже очень давно.'],
  ['Часы с кукушкой', 'Кукушка давно не выходит. Но что-то в них стучит.'],
  ['Хрустальная ваза', 'Хрупкий груз. Разобьёте — вычтем из зарплаты.'],
  ['Глобус', 'На нём нет вашего города.'],
  ['Фляга', 'Пустая, но всё равно булькает.'],
  ['Кислородный баллон', 'Давление в норме. Наверное.'],
  ['Ящик с болтами', 'Тяжёлый. Компания ценит ваш вклад в логистику.'],
  ['Медная табличка', '«Здесь работал сотрудник №…». Дальше не разобрать.'],
];

function nextLootCode(missionId: number) {
  const rows = q.all<{ code: string }>('SELECT code FROM loot WHERE mission_id = ?', missionId);
  const max = rows.reduce((acc, r) => Math.max(acc, Number(r.code.replace(/\D/g, '')) || 0), 0);
  return `SCR-${String(max + 1).padStart(3, '0')}`;
}

function insertLoot(missionId: number, name: string, value: number, description: string) {
  q.run(
    'INSERT INTO loot (mission_id, code, name, description, value, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    missionId, nextLootCode(missionId), name, description, value, randomToken(16), now(),
  );
}

function optText(v: unknown, name: string, max: number): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') fail(400, `Некорректное значение: ${name}`);
  const s = (v as string).trim();
  if (s.length > max) fail(400, `Поле «${name}» слишком длинное`);
  return s;
}

export function createLoot(
  o: { name?: unknown; value?: unknown; description?: unknown; count?: unknown; min?: unknown; max?: unknown },
  actor: Actor,
) {
  return mutate(() => {
    const m = mustMission();
    const count = o.count === undefined ? 1 : int(o.count, 'Количество', 1, 200);
    const min = o.min === undefined ? 20 : int(o.min, 'Мин. ценность', 1, 1e6);
    const max = o.max === undefined ? 120 : int(o.max, 'Макс. ценность', min, 1e6);
    const fixedValue = o.value === undefined || o.value === '' ? null : int(o.value, 'Ценность', 1, 1e6);
    const fixedName = o.name === undefined || o.name === '' ? null : text(o.name, 'Название', 60);
    const fixedDesc = optText(o.description, 'Описание', 300);
    for (let i = 0; i < count; i++) {
      const [poolName, poolDesc] = SCRAP_POOL[crypto.randomInt(SCRAP_POOL.length)];
      const value = fixedValue ?? (Math.round((min + crypto.randomInt(max - min + 1)) / 5) * 5 || min);
      insertLoot(m.id, fixedName ?? poolName, value, fixedName ? fixedDesc : fixedDesc || poolDesc);
    }
    logEvent(m.id, 'ADMIN', 'info', `${count} scrap object(s) registered`, 'admin', actor.label);
  });
}

/** Bulk list, one item per line: "Название; ценность; описание". Validates everything before inserting anything. */
export function importLoot(list: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (typeof list !== 'string' || !list.trim()) fail(400, 'Список пуст');
    const lines = (list as string).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 300) fail(400, 'Не больше 300 предметов за раз');
    const rows = lines.map((line, i) => {
      const [rawName = '', rawValue = '', ...rest] = line.split(';');
      const name = rawName.trim();
      const value = rawValue.trim();
      const where = `строка ${i + 1}`;
      if (!name || name.length > 60) fail(400, `${where}: название пустое или длиннее 60 символов`);
      const v = Number(value);
      if (!Number.isInteger(v) || v < 1 || v > 1e6) fail(400, `${where}: ценность должна быть целым числом`);
      const description = rest.join(';').trim();
      if (description.length > 300) fail(400, `${where}: описание длиннее 300 символов`);
      return { name, value: v, description };
    });
    for (const r of rows) insertLoot(m.id, r.name, r.value, r.description);
    logEvent(m.id, 'ADMIN', 'info', `${rows.length} scrap object(s) imported`, 'admin', actor.label);
    return { count: rows.length };
  });
}

export function updateLoot(id: unknown, patch: { name?: unknown; value?: unknown; description?: unknown }, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const item = mustLoot(m, id);
    if (patch.name !== undefined) q.run('UPDATE loot SET name = ? WHERE id = ?', text(patch.name, 'Название', 60), item.id);
    if (patch.description !== undefined) q.run('UPDATE loot SET description = ? WHERE id = ?', optText(patch.description, 'Описание', 300), item.id);
    if (patch.value !== undefined) {
      if (item.status === 'extracted') fail(409, 'Нельзя менять ценность извлечённого предмета');
      q.run('UPDATE loot SET value = ? WHERE id = ?', int(patch.value, 'Ценность', 1, 1e6), item.id);
    }
    logEvent(m.id, 'ADMIN', 'info', `Scrap ${item.code} updated`, 'admin', actor.label);
  });
}

export function deleteLoot(id: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const item = mustLoot(m, id);
    if (item.status === 'extracted') fail(409, 'Нельзя удалить извлечённый предмет');
    q.run('DELETE FROM loot WHERE id = ?', item.id);
    logEvent(m.id, 'ADMIN', 'warn', `Scrap ${item.code} deleted`, 'admin', actor.label);
  });
}

export function lootForPrint() {
  const m = mustMission();
  return q.all<{ id: number; code: string; name: string; description: string; value: number; token: string; status: string }>(
    'SELECT id, code, name, description, value, token, status FROM loot WHERE mission_id = ? ORDER BY code', m.id,
  );
}

// ---------------------------------------------------------------- store

export function purchase(itemId: unknown, o: { requestId?: unknown; targetPlayerId?: unknown }, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireLive(m);
    if (typeof o.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(o.requestId)) fail(400, 'Нет идентификатора запроса');
    const requestId = o.requestId as string;
    const dup = q.get<PurchaseRow>('SELECT * FROM purchases WHERE request_id = ?', requestId);
    if (dup) return { purchaseId: dup.id, duplicate: true };
    const item = q.get<ShopRow>('SELECT * FROM shop_items WHERE id = ? AND mission_id = ?', int(itemId, 'itemId', 1, 1e9), m.id)
      ?? fail(404, 'Товар не найден');
    if (!item.enabled) fail(409, 'Товар недоступен');
    const bought = q.get<{ c: number }>('SELECT COUNT(*) AS c FROM purchases WHERE item_id = ?', item.id)!.c;
    if (item.max_purchases > 0 && bought >= item.max_purchases) fail(409, 'Лимит покупок исчерпан');

    let target: PlayerRow | null = null;
    if (item.key === 'radio' && m.comms_radio) fail(409, 'Связь уже установлена');
    if (item.key === 'bodycam' && m.cams_unlocked) fail(409, 'Камеры уже подключены');
    if (item.key === 'medkit') {
      target = mustPlayer(o.targetPlayerId);
      if (target.role !== 'crew') fail(409, 'Аптечка только для экипажа');
      if (hpOf(m.id, target.id) >= 100) fail(409, `${target.callsign} полностью здоров`);
    }
    const balance = balanceOf(m.id);
    if (balance < item.price) fail(402, `НЕДОСТАТОЧНО КРЕДИТОВ: ${balance} / ${item.price} CR`);

    const txId = addTx(m.id, -item.price, 'purchase', `STORE: ${item.name}${target ? ` → ${target.callsign}` : ''}`, actor.label, `purchase:${requestId}`, `shop:${item.key}`);
    const pid = q.run(
      'INSERT INTO purchases (mission_id, item_id, price, target_player_id, transaction_id, request_id, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      m.id, item.id, item.price, target?.id ?? null, txId, requestId, actor.label, now(),
    ).id;
    logEvent(m.id, 'STORE', 'info', `Purchased ${item.name} for ${item.price} CR`, 'all', actor.label);
    const done = (note: string) => q.run('UPDATE purchases SET fulfilled_at = ?, fulfillment = ? WHERE id = ?', now(), note, pid);

    switch (item.key) {
      case 'radio':
        q.run('UPDATE missions SET comms_radio = 1 WHERE id = ?', m.id);
        done('Связь установлена');
        logEvent(m.id, 'COMMS', 'ok', 'Signal established. Direct radio link online.', 'all', actor.label);
        fx('comms:unlocked', { type: 'comms', level: 'ok', title: 'SIGNAL ESTABLISHED', text: 'Прямая связь доступна' });
        break;
      case 'bodycam':
        q.run('UPDATE missions SET cams_unlocked = 1 WHERE id = ?', m.id);
        done('Камеры подключены');
        camsOnlineFx(m, actor);
        break;
      case 'medkit': {
        const hp = changeHp(m, target!.id, item.effect_value, 'medkit', `MEDKIT #${pid}`, actor.label, `medkit:${pid}`)!;
        done(`${target!.callsign}: ${hp.before}% → ${hp.after}%`);
        logEvent(m.id, 'STORE', 'ok', `MEDKIT applied to ${target!.callsign}: HP ${hp.before}% → ${hp.after}%`, 'all', actor.label);
        fx('system:alert', { type: 'medkit', level: 'ok', title: 'MEDKIT APPLIED', text: `${target!.callsign}: здоровье ${hp.after}%`, targetPlayerId: target!.id }, { playerId: target!.id }, 'staff');
        break;
      }
      case 'time_ext':
        q.run('UPDATE missions SET time_bonus_sec = time_bonus_sec + ? WHERE id = ?', item.effect_value, m.id);
        done(`+${item.effect_value} с к следующей вылазке`);
        logEvent(m.id, 'STORE', 'ok', `Next expedition extended by ${Math.round(item.effect_value / 60)} min`, 'all', actor.label);
        break;
      case 'scanner':
        logEvent(m.id, 'STORE', 'warn', 'Threat scanner request queued. Awaiting analysis…', 'all', actor.label);
        fx('system:alert', { type: 'scanner', level: 'warn', title: 'ЗАПРОС СКАНЕРА', text: 'Оператор купил THREAT SCANNER — отправьте подсказку' }, 'admin');
        break;
      case 'extraction':
        logEvent(m.id, 'STORE', 'warn', 'Emergency extraction authorized. Awaiting field command.', 'all', actor.label);
        fx('system:alert', { type: 'extraction', level: 'warn', title: 'EVAC AUTHORIZED', text: 'Оператор купил EMERGENCY EXTRACTION' }, 'admin');
        break;
      default:
        done('Выдано');
    }
    return { purchaseId: pid, duplicate: false };
  });
}

function mustPendingPurchase(m: MissionRow, id: unknown, key: string) {
  const p = q.get<PurchaseRow & { key: string }>(
    'SELECT p.*, s.key FROM purchases p JOIN shop_items s ON s.id = p.item_id WHERE p.id = ? AND p.mission_id = ?',
    int(id, 'purchaseId', 1, 1e9), m.id,
  ) ?? fail(404, 'Покупка не найдена');
  if (p.key !== key) fail(409, 'Неверный тип покупки');
  if (p.fulfilled_at) fail(409, 'Уже выполнено');
  return p;
}

export function answerScanner(purchaseId: unknown, hint: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const p = mustPendingPurchase(m, purchaseId, 'scanner');
    const body = text(hint, 'Подсказка', 300);
    q.run('UPDATE purchases SET fulfilled_at = ?, fulfillment = ? WHERE id = ?', now(), body, p.id);
    insertMessage(m, { role: 'admin', playerId: null, label: 'THREAT SCANNER' }, 'operator', null, `[SCAN RESULT] ${body}`, 'system', now());
    logEvent(m.id, 'THREAT', 'warn', `Threat scanner analysis complete: ${body}`, 'staff', actor.label);
    fx('system:alert', { type: 'scanner', level: 'warn', title: 'SCAN RESULT', text: body }, 'staff');
  });
}

export function emergencyExtraction(purchaseId: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireLive(m);
    const p = mustPendingPurchase(m, purchaseId, 'extraction');
    const exp = currentExpedition(m.id);
    if (!exp || exp.status !== 'active') fail(409, 'Нет активной вылазки');
    q.run(
      "UPDATE expedition_players SET status = CASE WHEN status = 'outside' THEN 'returning' ELSE status END, penalty_exempt = 1 WHERE expedition_id = ? AND status IN ('outside','returning')",
      exp!.id,
    );
    q.run('UPDATE expeditions SET emergency = 1 WHERE id = ?', exp!.id);
    q.run("UPDATE missions SET gate = 'open' WHERE id = ?", m.id);
    q.run('UPDATE purchases SET fulfilled_at = ?, fulfillment = ? WHERE id = ?', now(), `Эвакуация вылазки #${exp!.number}`, p.id);
    logEvent(m.id, 'EVAC', 'crit', 'EMERGENCY EXTRACTION INITIATED. Return to base at walking pace. Late penalties waived.', 'all', actor.label);
    fx('system:alert', { type: 'evac', level: 'crit', title: 'EMERGENCY EXTRACTION', text: 'Возвращайтесь на базу. Шагом, не бегом. Штрафы за опоздание отменены.' });
  });
}

export function updateShopItem(id: unknown, patch: Record<string, unknown>, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const item = q.get<ShopRow>('SELECT * FROM shop_items WHERE id = ? AND mission_id = ?', int(id, 'itemId', 1, 1e9), m.id) ?? fail(404, 'Товар не найден');
    const sets: [string, string | number][] = [];
    if (patch.price !== undefined) sets.push(['price', int(patch.price, 'Цена', 0, 1e7)]);
    if (patch.enabled !== undefined) sets.push(['enabled', patch.enabled ? 1 : 0]);
    if (patch.effectValue !== undefined) sets.push(['effect_value', int(patch.effectValue, 'Эффект', 0, 1e6)]);
    if (patch.maxPurchases !== undefined) sets.push(['max_purchases', int(patch.maxPurchases, 'Лимит', 0, 1000)]);
    if (patch.name !== undefined) sets.push(['name', text(patch.name, 'Название', 40)]);
    if (patch.description !== undefined) sets.push(['description', text(patch.description, 'Описание', 300)]);
    if (!sets.length) return;
    q.run(`UPDATE shop_items SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), item.id);
    logEvent(m.id, 'ECON', 'info', `Store item ${item.name} updated: ${sets.map(([k, v]) => `${k}=${v}`).join(', ')}`, 'staff', actor.label);
  });
}

// ---------------------------------------------------------------- economy

function reverseTxInner(m: MissionRow, txId: number, reason: string, actor: Actor) {
  const t = q.get<TxRow>('SELECT * FROM transactions WHERE id = ? AND mission_id = ?', txId, m.id) ?? fail(404, 'Операция не найдена');
  if (t.reversed_by_id) fail(409, 'Операция уже отменена');
  if (t.reverses_id) fail(409, 'Корректировку нельзя отменить — создайте новую операцию');
  if (t.kind === 'loot' && t.ref?.startsWith('loot:')) {
    const item = q.get<LootRow>('SELECT * FROM loot WHERE id = ?', Number(t.ref.slice(5)));
    if (item && item.status === 'extracted' && t.idem_key === `loot:${item.id}:${item.extract_seq}`) {
      undoExtractionInner(m, item, reason, actor);
      return;
    }
  }
  const cid = addTx(m.id, -t.amount, 'correction', `Корректировка #${t.id}: ${reason}`, actor.label, `reverse:${t.id}`, t.ref, t.id);
  q.run('UPDATE transactions SET reversed_by_id = ? WHERE id = ?', cid, t.id);
  if (t.kind === 'penalty') {
    q.run("UPDATE penalties SET cleared_at = COALESCE(cleared_at, ?), cleared_note = COALESCE(cleared_note, 'Отменён корректировкой') WHERE transaction_id = ?", now(), t.id);
  }
  logEvent(m.id, 'ECON', 'warn', `Transaction #${t.id} reversed (${t.amount > 0 ? '−' : '+'}${Math.abs(t.amount)} CR): ${reason}`, 'staff', actor.label);
}

export function reverseTransaction(txId: unknown, reason: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    reverseTxInner(m, int(txId, 'txId', 1, 1e9), typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 120) : 'ошибочная операция', actor);
  });
}

export function manualAdjust(amount: unknown, reason: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const a = int(amount, 'Сумма', -1e7, 1e7);
    if (a === 0) fail(400, 'Сумма не может быть нулевой');
    const why = text(reason, 'Причина', 120);
    addTx(m.id, a, 'manual', `Ручная операция: ${why}`, actor.label);
    logEvent(m.id, 'ECON', a > 0 ? 'ok' : 'warn', `Manual ${a > 0 ? 'credit' : 'debit'}: ${a > 0 ? '+' : ''}${a} CR — ${why}`, 'staff', actor.label);
  });
}

// ---------------------------------------------------------------- comms

function insertMessage(
  m: MissionRow, from: Actor, toType: MessageTo, toPlayerId: number | null, body: string, channel: string, deliverAt: number,
) {
  const id = q.run(
    `INSERT INTO messages (mission_id, from_role, from_player_id, to_type, to_player_id, body, channel, created_at, deliver_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, from.role, from.playerId, toType, toPlayerId, body, channel, now(), deliverAt,
  ).id;
  if (deliverAt <= now()) {
    const f = messageFx(toType, toPlayerId, from.role === 'player' ? from.label : senderLabel(from.role, channel, null), body);
    // Monster ⇄ field admin chat is private: the operator must not see or hear it.
    const monsterChat = from.playerRole === 'monster' || (toPlayerId !== null && getPlayer(toPlayerId)?.role === 'monster');
    fx(f.name, f.payload, ...(monsterChat ? (toType === 'admin' ? ['admin' as const] : [{ playerId: toPlayerId! }, 'admin' as const]) : f.target));
  }
  return id;
}

export function sendMessage(o: { toType?: unknown; toPlayerId?: unknown; body?: unknown }, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    if (m.status === 'ended') fail(409, 'Миссия завершена');
    const body = text(o.body, 'Сообщение', 500);
    const toType = o.toType as MessageTo;
    if (!['operator', 'admin', 'player', 'crew'].includes(toType)) fail(400, 'Неизвестный получатель');
    const toPlayer = toType === 'player' ? mustPlayer(o.toPlayerId) : null;
    const radioUp = !!m.comms_radio && !m.comms_disabled;
    const t = now();

    if (actor.role === 'admin') {
      if (toType === 'admin') fail(400, 'Нельзя отправить себе');
      // To a monster it is a private admin chat ('relay'); to crew it is a Company notice ('system').
      const channel = toType === 'operator' || toPlayer?.role === 'monster' ? 'relay' : 'system';
      insertMessage(m, actor, toType, toPlayer?.id ?? null, body, channel, t);
    } else if (actor.playerRole === 'monster') {
      // Monsters act on their own; their only line is a private chat with the field admin (never jammed).
      if (toType !== 'admin') fail(403, 'Монстр может писать только ведущему');
      insertMessage(m, actor, 'admin', null, body, 'relay', t);
    } else if (actor.role === 'operator') {
      if (toType === 'operator') fail(400, 'Нельзя отправить себе');
      if (toPlayer?.role === 'monster') fail(403, 'Нет связи с этим объектом');
      if (toType === 'admin') insertMessage(m, actor, 'admin', null, body, 'relay', t);
      else {
        if (!m.comms_radio) fail(403, 'НЕТ СВЯЗИ. Купите RADIO или используйте курьера.');
        if (m.comms_disabled) fail(403, 'СИГНАЛ ПОТЕРЯН. Связь временно недоступна.');
        insertMessage(m, actor, toType, toPlayer?.id ?? null, body, 'radio', t + m.message_delay_sec * 1000);
      }
    } else {
      if (toType !== 'operator') fail(403, 'Сотрудник может связаться только с оператором');
      if (!radioUp) fail(403, m.comms_radio ? 'СИГНАЛ ПОТЕРЯН' : 'НЕТ СВЯЗИ');
      insertMessage(m, actor, 'operator', null, body, 'radio', t + m.message_delay_sec * 1000);
    }
  });
}

// ---------------------------------------------------------------- threat control

export function setThreatLevel(level: unknown, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const l = int(level, 'Уровень угрозы', 0, 5);
    if (l === m.threat_level) return;
    q.run('UPDATE missions SET threat_level = ? WHERE id = ?', l, m.id);
    logEvent(m.id, 'THREAT', l >= 4 ? 'crit' : l >= 2 ? 'warn' : 'info', `Threat level ${l > m.threat_level ? 'raised' : 'lowered'} to ${l}/5`, 'all', actor.label);
    if (l > m.threat_level) fx('system:alert', { type: 'threat', level: l >= 4 ? 'crit' : 'warn', title: `THREAT LEVEL ${l}` });
  });
}

// Atmospheric threat events from the field admin. Monsters themselves act on their own (see monsterHit).
const THREAT_EVENTS: MonsterActionType[] = ['warning', 'spawn', 'effect', 'false_alarm'];

export function monsterAction(o: { action?: unknown; targetPlayerId?: unknown; text?: unknown }, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    requireRunning(m);
    const action = o.action as MonsterActionType;
    if (!THREAT_EVENTS.includes(action)) fail(400, 'Неизвестное действие');
    const target = o.targetPlayerId ? mustPlayer(o.targetPlayerId) : null;
    if (action === 'effect' && !target) fail(400, 'Выберите цель эффекта');
    const body = typeof o.text === 'string' && o.text.trim() ? o.text.trim().slice(0, 300) : '';
    q.run(
      'INSERT INTO monster_actions (mission_id, monster_id, action, target_player_id, text, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
      m.id, action, target?.id ?? null, body, now(),
    );
    const tgt = target ? ` near ${target.callsign}` : '';
    const crew: FxTarget[] = target ? [{ playerId: target.id }, 'staff'] : ['crew', 'staff'];

    switch (action) {
      case 'warning':
      case 'false_alarm':
        logEvent(m.id, 'THREAT', 'warn', `Unidentified movement detected${tgt}.${body ? ` ${body}` : ''}`, 'all', actor.label);
        if (action === 'false_alarm') logEvent(m.id, 'ADMIN', 'info', '↳ false alarm (decoy)', 'admin', actor.label);
        fx('monster:event', { type: 'warning', level: 'warn', title: 'MOVEMENT DETECTED', text: body || (target ? `Рядом с ${target.callsign}` : 'Неопознанная активность'), targetPlayerId: target?.id ?? null }, ...crew);
        break;
      case 'spawn':
        logEvent(m.id, 'THREAT', 'crit', `Hostile entity manifested${tgt}.${body ? ` ${body}` : ''}`, 'all', actor.label);
        fx('monster:event', { type: 'spawn', level: 'crit', title: 'HOSTILE ENTITY', text: body || 'Сохраняйте спокойствие. Не бегите.', targetPlayerId: target?.id ?? null }, ...crew);
        break;
      case 'effect':
        logEvent(m.id, 'THREAT', 'warn', `Entity effect on ${target!.callsign}: ${body || 'unknown'}`, 'all', actor.label);
        fx('monster:event', { type: 'effect', level: 'crit', title: 'ВЫ ПОД ВОЗДЕЙСТВИЕМ', text: body, targetPlayerId: target!.id }, { playerId: target!.id }, 'staff');
        break;
    }
  });
}

export function customEvent(o: { text?: unknown; level?: unknown; type?: unknown; visibility?: unknown }, actor: Actor) {
  return mutate(() => {
    const m = mustMission();
    const body = text(o.text, 'Текст события', 300);
    const level = (['info', 'ok', 'warn', 'crit'] as Level[]).includes(o.level as Level) ? (o.level as Level) : 'info';
    const type = typeof o.type === 'string' && /^[A-Z]{2,10}$/.test(o.type) ? o.type : 'SYSTEM';
    const visibility = (['all', 'staff', 'admin'] as Visibility[]).includes(o.visibility as Visibility) ? (o.visibility as Visibility) : 'all';
    logEvent(m.id, type, level, body, visibility, actor.label);
    if (level === 'warn' || level === 'crit') {
      fx('system:alert', { type: 'custom', level, title: `[${type}]`, text: body }, visibility === 'all' ? 'all' : visibility === 'staff' ? 'staff' : 'admin');
    }
  });
}
