import { q } from './db.js';
import { presence } from './presence.js';
import {
  balanceOf, currentExpedition, currentMission, latestExpedition, quotaProgressOf,
  type ExpeditionRow, type LootRow, type MissionRow, type PlayerRow, type PurchaseRow, type ShopRow, type TxRow, type TaskRow,
} from './game.js';
import type {
  CrewStatus, EpStatus, EventView, ExpeditionView, LootView, MessageView, MissionView, MonsterActionView,
  HealthEventView, HealthKind, PlayerView, Role, Snapshot, ShopItemView, PurchaseView, TxView, Visibility, Level, MessageTo, Channel,
  MonsterActionType, PlayerRole, TaskView,
} from '../shared/types.js';

function missionView(m: MissionRow): MissionView {
  return {
    id: m.id, code: m.code, name: m.name, status: m.status as MissionView['status'], quota: m.quota,
    startBalance: m.start_balance, durationSec: m.duration_sec, overdueDamage: m.overdue_damage, monsterDamage: m.monster_damage, crewSize: m.crew_size,
    gate: m.gate as MissionView['gate'], threatLevel: m.threat_level, commsRadio: !!m.comms_radio,
    commsDisabled: !!m.comms_disabled, camsUnlocked: !!m.cams_unlocked, scrapRadar: !!m.scrap_radar, messageDelaySec: m.message_delay_sec, timeBonusSec: m.time_bonus_sec,
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
  // Players without a health row are at full HP.
  const hp = new Map<number, number>(
    m ? q.all<{ player_id: number; hp: number }>('SELECT player_id, hp FROM health WHERE mission_id = ?', m.id).map((r) => [r.player_id, r.hp]) : [],
  );
  const live = exp && exp.status !== 'completed' ? exp : null;
  return rows.map((p) => {
    const ep = live?.players.find((x) => x.playerId === p.id);
    return {
      id: p.id, callsign: p.callsign, role: p.role as PlayerRole, joinCode: withCodes ? p.join_code : undefined,
      status: ep ? EP_TO_CREW[ep.status] : 'AT_BASE', hp: hp.get(p.id) ?? 100, online: presence.isOnline(p.id), camOn: presence.isCamOn(p.id),
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

function healthView(missionId: number, where: string, params: number[], limit: number): HealthEventView[] {
  return q.all<{ id: number; player_id: number; callsign: string; delta: number; hp_after: number; kind: HealthKind; reason: string; actor: string; created_at: number }>(
    `SELECT h.*, p.callsign FROM health_events h JOIN players p ON p.id = h.player_id
     WHERE h.mission_id = ? AND (${where}) ORDER BY h.id DESC LIMIT ${limit}`,
    missionId, ...params,
  ).map((h) => ({
    id: h.id, playerId: h.player_id, callsign: h.callsign, delta: h.delta, hpAfter: h.hp_after, kind: h.kind,
    reason: h.reason, actor: h.actor, createdAt: h.created_at,
  }));
}

function tasksView(missionId: number, role: Role, playerId: number | null = null): TaskView[] {
  const rows = q.all<TaskRow & { callsign: string | null }>(
    `SELECT t.*, p.callsign FROM tasks t LEFT JOIN players p ON p.id = t.player_id
     WHERE t.mission_id = ?${role === 'player' ? ' AND t.player_id = ?' : ''} ORDER BY t.id`,
    missionId, ...(role === 'player' ? [playerId] : []),
  );
  return rows.map((t) => ({
    id: t.id, name: t.name, status: t.status, reward: t.reward, playerId: t.player_id, callsign: t.callsign,
    employeeText: role === 'operator' ? '' : t.employee_text, startedAt: t.started_at, completedAt: t.completed_at,
    ...(role === 'admin' ? { operatorText: t.operator_text, answer: t.answer, token: t.token } :
      role === 'operator' && t.status !== 'available' ? { operatorText: t.operator_text } : {}),
  }));
}

function emptySnapshot(role: Role, t: number): Snapshot {
  return {
    serverNow: t, role, me: null, mission: null, raidActive: false, balance: 0, quotaProgress: 0, lootStats: { total: 0, found: 0, extracted: 0 },
    expedition: null, players: [], health: [], loot: [], transactions: [], shop: [], purchases: [], messages: [],
    events: [], monsterActions: [], tasks: [], manifest: [],
  };
}

/** `total` is withheld (null) unless the viewer may know how much scrap exists: admin, or after SCRAP RADAR. */
function lootStats(missionId: number, revealTotal: boolean) {
  const r = q.get<{ total: number; found: number; extracted: number }>(
    `SELECT COUNT(*) AS total, SUM(status = 'found') AS found, SUM(status = 'extracted') AS extracted FROM loot WHERE mission_id = ?`,
    missionId,
  )!;
  return { total: revealTotal ? r.total : null, found: (r.found ?? 0) + (r.extracted ?? 0), extracted: r.extracted ?? 0 };
}

const ALL_LOOT = 'SELECT l.*, p.callsign FROM loot l LEFT JOIN players p ON p.id = l.found_by WHERE l.mission_id = ? ORDER BY l.code';

export function staffSnapshot(role: 'admin' | 'operator'): Snapshot {
  const t = Date.now();
  const s = emptySnapshot(role, t);
  const m = currentMission();
  s.players = playersView(m, null, role === 'admin');
  if (!m) return s;
  const isAdmin = role === 'admin';
  const exp = latestExpedition(m.id);
  s.mission = missionView(m);
  s.raidActive = currentExpedition(m.id)?.status === 'active';
  s.tasks = tasksView(m.id, role);
  s.balance = balanceOf(m.id);
  s.quotaProgress = quotaProgressOf(m.id);
  // Without SCRAP RADAR the operator sees only scrap that a crew member has already scanned.
  const seeAll = isAdmin || !!m.scrap_radar;
  s.lootStats = lootStats(m.id, seeAll);
  s.expedition = exp ? expeditionView(exp) : null;
  s.players = playersView(m, s.expedition, isAdmin);
  s.health = healthView(m.id, '1 = 1', [], 200);
  s.loot = q.all<LootRow & { callsign: string | null }>(ALL_LOOT, m.id)
    .filter((l) => seeAll || l.status !== 'available')
    .map(lootView);
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
    : messagesView(
        m.id,
        // The operator never sees the private monster ⇄ admin chat.
        "((msg.to_type <> 'admin' AND msg.deliver_at <= ?) OR msg.from_role = 'operator') AND COALESCE(tp.role, '') <> 'monster' AND COALESCE(fp.role, '') <> 'monster'",
        [t], t,
      );
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
  s.raidActive = currentExpedition(m.id)?.status === 'active';
  s.tasks = p.role === 'crew' ? tasksView(m.id, 'player', p.id) : [];
  s.balance = balanceOf(m.id);
  s.quotaProgress = quotaProgressOf(m.id);
  s.lootStats = lootStats(m.id, !!m.scrap_radar);
  // SCRAP RADAR shows crew the whole object manifest (names, value and status; there is no map, so no locations).
  s.manifest = p.role === 'crew' && m.scrap_radar ? q.all<LootRow & { callsign: string | null }>(ALL_LOOT, m.id).map(lootView) : [];
  const exp = latestExpedition(m.id);
  const ev = exp ? expeditionView(exp) : null;
  // Crew see their own expedition only; monsters see the field roster to know who is out.
  s.expedition = ev && (p.role === 'monster' || ev.players.some((x) => x.playerId === p.id)) ? ev : null;
  s.players = playersView(m, ev, false).filter((x) => x.id === p.id || (p.role === 'monster' && x.role === 'crew'));
  s.health = healthView(m.id, 'h.player_id = ?', [p.id], 30);
  s.loot = q.all<LootRow & { callsign: string | null }>(
    'SELECT l.*, p.callsign FROM loot l LEFT JOIN players p ON p.id = l.found_by WHERE l.mission_id = ? AND l.found_by = ? ORDER BY l.found_at DESC',
    m.id, p.id,
  ).map(lootView);
  s.messages = p.role === 'monster'
    // Monsters only have their private chat with the field admin.
    ? messagesView(m.id, "(msg.to_type = 'player' AND msg.to_player_id = ?) OR msg.from_player_id = ?", [p.id, p.id], t)
    : messagesView(
        m.id,
        "(msg.deliver_at <= ? AND ((msg.to_type = 'player' AND msg.to_player_id = ?) OR msg.to_type = 'crew')) OR msg.from_player_id = ?",
        [t, p.id, p.id], t,
      );
  s.events = eventsView(m.id, ['all'], 40);
  return s;
}
