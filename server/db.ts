import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
export const DATA_DIR = path.resolve(arg('data') ?? process.env.DATA_DIR ?? 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'game.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  quota INTEGER NOT NULL DEFAULT 1000,
  start_balance INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 900,
  overdue_penalty INTEGER NOT NULL DEFAULT 50,
  crew_size INTEGER NOT NULL DEFAULT 4,
  gate TEXT NOT NULL DEFAULT 'closed',
  threat_level INTEGER NOT NULL DEFAULT 0,
  comms_radio INTEGER NOT NULL DEFAULT 0,
  comms_disabled INTEGER NOT NULL DEFAULT 0,
  message_delay_sec INTEGER NOT NULL DEFAULT 0,
  time_bonus_sec INTEGER NOT NULL DEFAULT 0,
  pause_reason TEXT,
  started_at INTEGER,
  paused_at INTEGER,
  paused_total_ms INTEGER NOT NULL DEFAULT 0,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  callsign TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'crew',
  join_code TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  player_id INTEGER REFERENCES players(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expeditions (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing',
  duration_sec INTEGER NOT NULL,
  opened_at INTEGER,
  deadline_at INTEGER,
  completed_at INTEGER,
  emergency INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expedition_players (
  id INTEGER PRIMARY KEY,
  expedition_id INTEGER NOT NULL REFERENCES expeditions(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'ready',
  exit_at INTEGER,
  deadline_at INTEGER,
  returned_at INTEGER,
  overdue_at INTEGER,
  penalty_exempt INTEGER NOT NULL DEFAULT 0,
  UNIQUE (expedition_id, player_id)
);

CREATE TABLE IF NOT EXISTS penalties (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  reason TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  transaction_id INTEGER,
  idem_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  cleared_at INTEGER,
  cleared_note TEXT
);

CREATE TABLE IF NOT EXISTS loot (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  found_by INTEGER REFERENCES players(id),
  found_at INTEGER,
  extracted_at INTEGER,
  extract_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (mission_id, token),
  UNIQUE (mission_id, code)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  ref TEXT,
  idem_key TEXT UNIQUE,
  reverses_id INTEGER,
  reversed_by_id INTEGER,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  effect_value INTEGER NOT NULL DEFAULT 0,
  max_purchases INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (mission_id, key)
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  item_id INTEGER NOT NULL REFERENCES shop_items(id),
  price INTEGER NOT NULL,
  target_player_id INTEGER REFERENCES players(id),
  transaction_id INTEGER,
  request_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fulfilled_at INTEGER,
  fulfillment TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  from_role TEXT NOT NULL,
  from_player_id INTEGER,
  to_type TEXT NOT NULL,
  to_player_id INTEGER,
  body TEXT NOT NULL,
  channel TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deliver_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  text TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'all',
  actor TEXT NOT NULL DEFAULT 'SYSTEM',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monster_actions (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  monster_id INTEGER REFERENCES players(id),
  action TEXT NOT NULL,
  target_player_id INTEGER REFERENCES players(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_mission ON events (mission_id, id);
CREATE INDEX IF NOT EXISTS idx_tx_mission ON transactions (mission_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_mission ON messages (mission_id, deliver_at);
`);

// Additive migrations for databases created by earlier versions.
const lootCols = db.prepare('PRAGMA table_info(loot)').all() as { name: string }[];
if (!lootCols.some((c) => c.name === 'description')) {
  db.exec("ALTER TABLE loot ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}

const cache = new Map<string, StatementSync>();
function prep(sql: string): StatementSync {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

type P = SQLInputValue;

export const q = {
  get<T>(sql: string, ...params: P[]): T | undefined {
    return prep(sql).get(...params) as T | undefined;
  },
  all<T>(sql: string, ...params: P[]): T[] {
    return prep(sql).all(...params) as T[];
  },
  run(sql: string, ...params: P[]): { changes: number; id: number } {
    const r = prep(sql).run(...params);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
};

let depth = 0;
/** Runs fn inside a single SQLite write transaction; nested calls join the outer one. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function kvGet(key: string): string | null {
  return q.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value ?? null;
}
export function kvSet(key: string, value: string | null) {
  if (value === null) q.run('DELETE FROM kv WHERE key = ?', key);
  else q.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
