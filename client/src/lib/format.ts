import type { CrewStatus, EpStatus, GateStatus, Level, LootStatus, MissionStatus } from '@shared/types';

const pad = (n: number) => String(n).padStart(2, '0');

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'mute' | 'acc';

/** Countdown text. Negative values are overtime and rendered with a leading "+". */
export function mmss(ms: number) {
  const neg = ms < 0;
  const s = neg ? Math.ceil(-ms / 1000) : Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const body = h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  return (neg ? '+' : '') + body;
}

export function clock(ts: number | null | undefined, seconds = true) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
}

export function cr(n: number) {
  return n.toLocaleString('ru-RU').replace(/\s/g, ' ');
}

export function missionElapsed(
  m: { startedAt: number | null; pausedAt: number | null; endedAt: number | null; pausedTotalMs: number },
  now: number,
) {
  if (!m.startedAt) return 0;
  const end = m.endedAt ?? m.pausedAt ?? now;
  return Math.max(0, end - m.startedAt - m.pausedTotalMs);
}

export function remaining(deadline: number | null, now: number, pausedAt: number | null) {
  if (!deadline) return null;
  return deadline - (pausedAt ?? now);
}

export const CREW_LABEL: Record<CrewStatus, string> = {
  AT_BASE: 'AT BASE', READY: 'READY', OUTSIDE: 'OUTSIDE', RETURNING: 'RETURNING', OVERDUE: 'OVERDUE',
};
export const CREW_TONE: Record<CrewStatus, Tone> = {
  AT_BASE: 'ok', READY: 'info', OUTSIDE: 'warn', RETURNING: 'info', OVERDUE: 'crit',
};
export const EP_TO_CREW: Record<EpStatus, CrewStatus> = {
  ready: 'READY', outside: 'OUTSIDE', returning: 'RETURNING', overdue: 'OVERDUE', returned: 'AT_BASE',
};
export const LOOT_TONE: Record<LootStatus, Tone> = { available: 'mute', found: 'warn', extracted: 'ok' };
export const GATE_TONE: Record<GateStatus, Tone> = { open: 'acc', closing: 'crit', closed: 'mute' };
export const MISSION_TONE: Record<MissionStatus, Tone> = { draft: 'info', active: 'ok', paused: 'crit', ended: 'mute' };
export const MISSION_LABEL: Record<MissionStatus, string> = {
  draft: 'STANDBY', active: 'ACTIVE', paused: 'PAUSED', ended: 'TERMINATED',
};
export const levelTone = (l: Level): Tone => (l === 'ok' ? 'ok' : l === 'warn' ? 'warn' : l === 'crit' ? 'crit' : 'info');
