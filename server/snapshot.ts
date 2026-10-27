import { q } from './db.js';
import { presence } from './presence.js';
import {
  balanceOf, currentMission, latestExpedition, quotaProgressOf,
  type ExpeditionRow, type LootRow, type MissionRow, type PlayerRow, type PurchaseRow, type ShopRow, type TxRow,
} from './game.js';
import type {
  CrewStatus, EpStatus, EventView, ExpeditionView, LootView, MessageView, MissionView, MonsterActionView,
  PenaltyView, PlayerView, Role, Snapshot, ShopItemView, PurchaseView, TxView, Visibility, Level, MessageTo, Channel,
  MonsterActionType, PlayerRole,
} from '../shared/types.js';

function missionView(m: MissionRow): MissionView {
  return {
    id: m.id, code: m.code, name: m.name, status: m.status as MissionView['status'], quota: m.quota,
    startBalance: m.start_balance, durationSec: m.duration_sec, overduePenalty: m.overdue_penalty, crewSize: m.crew_size,
    gate: m.gate as MissionView['gate'], threatLevel: m.threat_level, commsRadio: !!m.comms_radio,
    commsDisabled: !!m.comms_disabled, camsUnlocked: !!m.cams_unlocked, messageDelaySec: m.message_delay_sec, timeBonusSec: m.time_bonus_sec,
    pauseReason: m.pause_reason, startedAt: m.started_at, pausedAt: m.paused_at, pausedTotalMs: m.paused_total_ms,
    endedAt: m.ended_at,
  };
}

function expeditionView(e: ExpeditionRow): ExpeditionView {
  const players = q.all<{
    id: number; player_id: number; callsign: string; status: EpStatus; exit_at: number | null; deadline_at: number | null;
    returned_at: number | null; overdue_at: number | null; penalty_exempt: number;
  }>(
    'SELECT ep.*, p.callsign FROM expedition_players ep JOIN players p ON p.id = ep.player_id WHERE ep.expedition_id = ? ORDER BY ep.id',
    e.id,
  );
  return {
    id: e.id, number: e.number, status: e.status as ExpeditionView['status'], durationSec: e.duration_sec,
    openedAt: e.opened_at, deadlineAt: e.deadline_at, completedAt: e.completed_at, emergency: !!e.emergency,
    players: players.map((p) => ({
      id: p.id, playerId: p.player_id, callsign: p.callsign, status: p.status, exitAt: p.exit_at,
      deadlineAt: p.deadline_at, returnedAt: p.returned_at, overdueAt: p.overdue_at, penaltyExempt: !!p.penalty_exempt,
    })),
  };
}

const EP_TO_CREW: Record<EpStatus, CrewStatus> = {
  ready: 'READY', outside: 'OUTSIDE', returning: 'RETURNING', overdue: 'OVERDUE', returned: 'AT_BASE',
};

function playersView(m: MissionRow | undefined, exp: ExpeditionView | null, withCodes: boolean): PlayerView[] {
  const rows = q.all<PlayerRow>('SELECT * FROM players WHERE active = 1 ORDER BY role, id');
  const pen = new Map<number, number>();
  if (m) {
    for (const r of q.all<{ player_id: number; c: number }>(
      'SELECT player_id, COUNT(*) AS c FROM penalties WHERE mission_id = ? AND cleared_at IS NULL GROUP BY player_id', m.id,
    )) pen.set(r.player_id, r.c);
  }
  const live = exp && exp.status !== 'completed' ? exp : null;
  return rows.map((p) => {
    const ep = live?.players.find((x) => x.playerId === p.id);
    return {
      id: p.id, callsign: p.callsign, role: p.role as PlayerRole, joinCode: withCodes ? p.join_code : undefined,
      status: ep ? EP_TO_CREW[ep.status] : 'AT_BASE', penalties: pen.get(p.id) ?? 0, online: presence.isOnline(p.id), camOn: presence.isCamOn(p.id),
      exitAt: ep?.exitAt ?? null, deadlineAt: ep?.deadlineAt ?? null,
    };
  });
}

function lootView(r: LootRow & { callsign: string | null }): LootView {
  return {
    id: r.id, code: r.code, name: r.name, description: r.description, value: r.value, status: r.status as LootView['status'], foundBy: r.callsign,
    foundAt: r.found_at, extractedAt: r.extracted_at,
  };
}

function eventsView(missionId: number, allowed: Visibility[], limit: number): EventView[] {
  const marks = allowed.map(() => '?').join(',');
  return q.all<{ id: number; type: string; level: Level; text: string; visibility: Visibility; actor: string; created_at: number }>(
    `SELECT * FROM events WHERE mission_id = ? AND visibility IN (${marks}) ORDER BY id DESC LIMIT ?`,
    missionId, ...allowed, limit,
  ).reverse().map((e) => ({ id: e.id, type: e.type, level: e.level, text: e.text, visibility: e.visibility, actor: e.actor, createdAt: e.created_at }));
}

interface MsgRow {
  id: number; from_role: Role; from_player_id: number | null; to_type: MessageTo; to_player_id: number | null; body: string;
  channel: Channel; created_at: number; deliver_at: number; from_cs: string | null; to_cs: string | null;
}
function messagesView(missionId: number, where: string, params: (number | string)[], t: number): MessageView[] {
  return q.all<MsgRow>(
    `SELECT msg.*, fp.callsign AS from_cs, tp.callsign AS to_cs FROM messages msg
     LEFT JOIN players fp ON fp.id = msg.from_player_id LEFT JOIN players tp ON tp.id = msg.to_player_id
     WHERE msg.mission_id = ? AND (${where}) ORDER BY msg.id DESC LIMIT 150`,
    missionId, ...params,
  ).reverse().map((r) => ({
    id: r.id, fromRole: r.from_role,
    fromCallsign: r.from_cs ?? (r.from_role === 'admin' ? (r.channel === 'system' ? 'COMPANY' : 'FIELD ADMIN') : 'OPERATOR'),
    toType: r.to_type, toPlayerId: r.to_player_id, toCallsign: r.to_cs, body: r.body, channel: r.channel,
    createdAt: r.created_at, deliverAt: r.deliver_at, delivered: r.deliver_at <= t,
  }));
}

function monsterActionsView(missionId: number, where: string, params: number[]): MonsterActionView[] {
  return q.all<{ id: number; monster_id: number | null; action: MonsterActionType; target_player_id: number | null; text: string; created_at: number; mcs: string | null; tcs: string | null }>(
    `SELECT a.*, mp.callsign AS mcs, tp.callsign AS tcs FROM monster_actions a
     LEFT JOIN players mp ON mp.id = a.monster_id LEFT JOIN players tp ON tp.id = a.target_player_id
     WHERE a.mission_id = ? AND (${where}) ORDER BY a.id DESC LIMIT 40`,
    missionId, ...params,
  ).map((a) => ({
    id: a.id, monsterId: a.monster_id, monster: a.mcs, action: a.action, targetId: a.target_player_id, target: a.tcs,
    text: a.text, createdAt: a.created_at,
  }));
}

function emptySnapshot(role: Role, t: number): Snapshot {
  return {
    serverNow: t, role, me: null, mission: null, balance: 0, quotaProgress: 0, lootStats: { total: 0, found: 0, extracted: 0 },
    expedition: null, players: [], penalties: [], loot: [], transactions: [], shop: [], purchases: [], messages: [],
    events: [], monsterActions: [],
  };
}

function lootStats(missionId: number) {
  const r = q.get<{ total: number; found: number; extracted: number }>(
    `SELECT COUNT(*) AS total, SUM(status = 'found') AS found, SUM(status = 'extracted') AS extracted FROM loot WHERE mission_id = ?`,
    missionId,
  )!;
  return { total: r.total, found: (r.found ?? 0) + (r.extracted ?? 0), extracted: r.extracted ?? 0 };
}

export function staffSnapshot(role: 'admin' | 'operator'): Snapshot {
  const t = Date.now();
  const s = emptySnapshot(role, t);
  const m = currentMission();
  s.players = playersView(m, null, role === 'admin');
  if (!m) return s;
  const isAdmin = role === 'admin';
  const exp = latestExpedition(m.id);
  s.mission = missionView(m);
  s.balance = balanceOf(m.id);
  s.quotaProgress = quotaProgressOf(m.id);
  s.lootStats = lootStats(m.id);
  s.expedition = exp ? expeditionView(exp) : null;
  s.players = playersView(m, s.expedition, isAdmin);
  s.penalties = q.all<{ id: number; player_id: number; callsign: string; reason: string; amount: number; created_at: number; cleared_at: number | null; cleared_note: string | null }>(
    'SELECT pe.*, p.callsign FROM penalties pe JOIN players p ON p.id = pe.player_id WHERE pe.mission_id = ? ORDER BY pe.id DESC',
    m.id,
  ).map((p) => ({ id: p.id, playerId: p.player_id, callsign: p.callsign, reason: p.reason, amount: p.amount, createdAt: p.created_at, clearedAt: p.cleared_at, clearedNote: p.cleared_note }));
  s.loot = q.all<LootRow & { callsign: string | null }>(
    'SELECT l.*, p.callsign FROM loot l LEFT JOIN players p ON p.id = l.found_by WHERE l.mission_id = ? ORDER BY l.code', m.id,
  ).map(lootView);
  s.transactions = q.all<TxRow>(`SELECT * FROM transactions WHERE mission_id = ? ORDER BY id DESC LIMIT ${isAdmin ? 300 : 60}`, m.id)
    .map((x): TxView => ({ id: x.id, amount: x.amount, kind: x.kind, description: x.description, actor: x.actor, createdAt: x.created_at, reversesId: x.reverses_id, reversedById: x.reversed_by_id }));
  const bought = new Map(q.all<{ item_id: number; c: number }>('SELECT item_id, COUNT(*) AS c FROM purchases WHERE mission_id = ? GROUP BY item_id', m.id).map((r) => [r.item_id, r.c]));
  s.shop = q.all<ShopRow>('SELECT * FROM shop_items WHERE mission_id = ? ORDER BY sort', m.id).map((i): ShopItemView => ({
    id: i.id, key: i.key, name: i.name, description: i.description, price: i.price, enabled: !!i.enabled,
    effectValue: i.effect_value, maxPurchases: i.max_purchases, bought: bought.get(i.id) ?? 0,
  }));
  s.purchases = q.all<PurchaseRow & { key: string; name: string; tcs: string | null }>(
    `SELECT pu.*, s.key, s.name, p.callsign AS tcs FROM purchases pu JOIN shop_items s ON s.id = pu.item_id
     LEFT JOIN players p ON p.id = pu.target_player_id WHERE pu.mission_id = ? ORDER BY pu.id DESC`, m.id,
  ).map((p): PurchaseView => ({
    id: p.id, itemKey: p.key, itemName: p.name, price: p.price, targetCallsign: p.tcs, actor: p.actor,
    createdAt: p.created_at, fulfilledAt: p.fulfilled_at, fulfillment: p.fulfillment,
  }));
  s.messages = isAdmin
    ? messagesView(m.id, '1 = 1', [], t)
    : messagesView(m.id, "(msg.to_type <> 'admin' AND msg.deliver_at <= ?) OR msg.from_role = 'operator'", [t], t);
  s.events = eventsView(m.id, isAdmin ? ['all', 'staff', 'admin'] : ['all', 'staff'], isAdmin ? 400 : 150);
  s.monsterActions = isAdmin ? monsterActionsView(m.id, '1 = 1', []) : [];
  return s;
}

export function playerSnapshot(playerId: number): Snapshot {
  const t = Date.now();
  const s = emptySnapshot('player', t);
  const p = q.get<PlayerRow>('SELECT * FROM players WHERE id = ?', playerId);
  if (!p) return s;
  s.me = { playerId: p.id, callsign: p.callsign, role: p.role as PlayerRole };
  const m = currentMission();
  if (!m) return s;
  s.mission = missionView(m);
  s.balance = balanceOf(m.id);
  s.quotaProgress = quotaProgressOf(m.id);
  s.lootStats = lootStats(m.id);
  const exp = latestExpedition(m.id);
  const ev = exp ? expeditionView(exp) : null;
  // Crew see their own expedition only; monsters see the field roster to know who is out.
  s.expedition = ev && (p.role === 'monster' || ev.players.some((x) => x.playerId === p.id)) ? ev : null;
  s.players = playersView(m, ev, false).filter((x) => x.id === p.id || (p.role === 'monster' && x.role === 'crew'));
  s.penalties = q.all<{ id: number; reason: string; amount: number; created_at: number; cleared_at: number | null; cleared_note: string | null }>(
    'SELECT * FROM penalties WHERE mission_id = ? AND player_id = ? ORDER BY id DESC', m.id, p.id,
  ).map((x): PenaltyView => ({ id: x.id, playerId: p.id, callsign: p.callsign, reason: x.reason, amount: x.amount, createdAt: x.created_at, clearedAt: x.cleared_at, clearedNote: x.cleared_note }));
  s.loot = q.all<LootRow & { callsign: string | null }>(
    'SELECT l.*, p.callsign FROM loot l LEFT JOIN players p ON p.id = l.found_by WHERE l.mission_id = ? AND l.found_by = ? ORDER BY l.found_at DESC',
    m.id, p.id,
  ).map(lootView);
  s.messages = messagesView(
    m.id,
    "(msg.deliver_at <= ? AND ((msg.to_type = 'player' AND msg.to_player_id = ?) OR msg.to_type = 'crew')) OR msg.from_player_id = ?",
    [t, p.id, p.id], t,
  );
  s.events = eventsView(m.id, ['all'], 40);
  s.monsterActions = p.role === 'monster' ? monsterActionsView(m.id, 'a.monster_id = ?', [p.id]) : [];
  return s;
}
