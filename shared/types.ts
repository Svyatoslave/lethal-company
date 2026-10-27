// Shared contract between server snapshots and clients.

export type Role = 'admin' | 'operator' | 'player';
export type PlayerRole = 'crew' | 'monster';
export type MissionStatus = 'draft' | 'active' | 'paused' | 'ended';
export type GateStatus = 'open' | 'closing' | 'closed';
export type EpStatus = 'ready' | 'outside' | 'returning' | 'overdue' | 'returned';
export type CrewStatus = 'AT_BASE' | 'READY' | 'OUTSIDE' | 'RETURNING' | 'OVERDUE';
export type ExpeditionStatus = 'preparing' | 'active' | 'completed' | 'cancelled';
export type LootStatus = 'available' | 'found' | 'extracted';
export type Visibility = 'all' | 'staff' | 'admin';
export type Level = 'info' | 'ok' | 'warn' | 'crit';
export type MessageTo = 'operator' | 'admin' | 'player' | 'crew';
export type Channel = 'relay' | 'radio' | 'system';
export type MonsterActionType = 'warning' | 'spawn' | 'effect' | 'false_alarm' | 'order';

export interface MissionView {
  id: number;
  code: string;
  name: string;
  status: MissionStatus;
  quota: number;
  startBalance: number;
  durationSec: number;
  overduePenalty: number;
  crewSize: number;
  gate: GateStatus;
  threatLevel: number;
  commsRadio: boolean;
  commsDisabled: boolean;
  camsUnlocked: boolean;
  messageDelaySec: number;
  timeBonusSec: number;
  pauseReason: string | null;
  startedAt: number | null;
  pausedAt: number | null;
  pausedTotalMs: number;
  endedAt: number | null;
}

export interface ExpPlayerView {
  id: number;
  playerId: number;
  callsign: string;
  status: EpStatus;
  exitAt: number | null;
  deadlineAt: number | null;
  returnedAt: number | null;
  overdueAt: number | null;
  penaltyExempt: boolean;
}

export interface ExpeditionView {
  id: number;
  number: number;
  status: ExpeditionStatus;
  durationSec: number;
  openedAt: number | null;
  deadlineAt: number | null;
  completedAt: number | null;
  emergency: boolean;
  players: ExpPlayerView[];
}

export interface PlayerView {
  id: number;
  callsign: string;
  role: PlayerRole;
  joinCode?: string;
  status: CrewStatus;
  penalties: number;
  online: boolean;
  /** The player's phone is publishing a body cam stream right now. */
  camOn: boolean;
  exitAt: number | null;
  deadlineAt: number | null;
}

export interface PenaltyView {
  id: number;
  playerId: number;
  callsign: string;
  reason: string;
  amount: number;
  createdAt: number;
  clearedAt: number | null;
  clearedNote: string | null;
}

export interface LootView {
  id: number;
  code: string;
  name: string;
  description: string;
  value: number;
  status: LootStatus;
  foundBy: string | null;
  foundAt: number | null;
  extractedAt: number | null;
}

export interface TxView {
  id: number;
  amount: number;
  kind: string;
  description: string;
  actor: string;
  createdAt: number;
  reversesId: number | null;
  reversedById: number | null;
}

export interface ShopItemView {
  id: number;
  key: string;
  name: string;
  description: string;
  price: number;
  enabled: boolean;
  effectValue: number;
  maxPurchases: number;
  bought: number;
}

export interface PurchaseView {
  id: number;
  itemKey: string;
  itemName: string;
  price: number;
  targetCallsign: string | null;
  actor: string;
  createdAt: number;
  fulfilledAt: number | null;
  fulfillment: string | null;
}

export interface MessageView {
  id: number;
  fromRole: Role;
  fromCallsign: string;
  toType: MessageTo;
  toPlayerId: number | null;
  toCallsign: string | null;
  body: string;
  channel: Channel;
  createdAt: number;
  deliverAt: number;
  delivered: boolean;
}

export interface EventView {
  id: number;
  type: string;
  level: Level;
  text: string;
  visibility: Visibility;
  actor: string;
  createdAt: number;
}

export interface MonsterActionView {
  id: number;
  monsterId: number | null;
  monster: string | null;
  action: MonsterActionType;
  targetId: number | null;
  target: string | null;
  text: string;
  createdAt: number;
}

export interface Snapshot {
  serverNow: number;
  role: Role;
  me: { playerId: number; callsign: string; role: PlayerRole } | null;
  mission: MissionView | null;
  /** An expedition is in the field right now (for every role, even players not in it). Loot scanning is locked. */
  raidActive: boolean;
  balance: number;
  quotaProgress: number;
  lootStats: { total: number; found: number; extracted: number };
  expedition: ExpeditionView | null;
  players: PlayerView[];
  penalties: PenaltyView[];
  loot: LootView[];
  transactions: TxView[];
  shop: ShopItemView[];
  purchases: PurchaseView[];
  messages: MessageView[];
  events: EventView[];
  monsterActions: MonsterActionView[];
}

/** Payload of every named realtime effect event (gate:closing, monster:event, ...). */
export interface FxEvent {
  type: string;
  level: Level;
  title: string;
  text?: string;
  /** When set, only this player's device should react loudly. */
  targetPlayerId?: number | null;
  at: number;
}

export const FX_EVENTS = [
  'mission:updated',
  'gate:opened',
  'gate:closing',
  'gate:closed',
  'player:overdue',
  'loot:found',
  'loot:extracted',
  'economy:updated',
  'comms:unlocked',
  'message:received',
  'monster:event',
  'system:alert',
] as const;
export type FxName = (typeof FX_EVENTS)[number];
