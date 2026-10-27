# AGENTS.md — OPERATION: LAST NIGHT (NIGHT RAID)

Guide for AI coding agents working in this repository. Human-facing setup and game rules are in `README.md` (Russian).

## What this is

A real-world night game for a bachelor party, styled as an industrial sci-fi horror "company terminal". Players walk a country-house plot at night, find hidden objects tagged with QR codes, bring them back through an "airlock", and the team earns credits toward a quota. One web app, three interfaces, one server:

| Route | Interface | Device | Who |
|---|---|---|---|
| `/operator` | OPERATOR TERMINAL | laptop at base | operator (PIN) |
| `/admin` | FIELD ADMIN | host's phone | game master (PIN) |
| `/crew` | CREW DEVICE | players' phones | players and two "monster" players (personal join code) |
| `/print` | QR labels and badges | any (admin login) | game master |

`/s/:token` (scrap QR) and `/join/:code` (badge QR) are deep links that redirect into `/crew`.

All UI copy is **Russian**; terminal/system strings (log tags, statuses like `OUTSIDE`, `AIRLOCK OPEN`) are deliberately **English** for atmosphere. Keep that split.

## Stack

- Node.js **22.13+** (uses built-in `node:sqlite`, no native modules). TypeScript run by `tsx`, no server build step.
- Server: Express 4, Socket.IO 4, SQLite (`data/game.db`, WAL).
- Client: Vue 3 (`<script setup>`), Vite, vue-router; no UI library — own design system in `client/src/components/ui`.
- `shared/types.ts` is the contract between server snapshots and clients (imported as `@shared/types` on the client).
- Body cams: WebRTC peer-to-peer; the server only relays signaling. Optional TURN relay (coturn) for internet use.

## Commands

```bash
npm install
npm run build          # vue-tsc typecheck + vite build into dist/
npm start              # https://<lan-ip>:8443, prints admin/operator PINs
npm run dev:server     # tsx watch
npm run dev:client     # vite on :5173, proxies /api and /socket.io to https://localhost:8443
npx tsc --noEmit -p server/tsconfig.json   # server typecheck
npx vue-tsc --noEmit -p tsconfig.json      # client typecheck
```

Server flags: `--http` (plain HTTP behind a TLS proxy), `--port=N`, `--data=DIR` (separate database — use this for tests, never touch `data/`). Env/`.env`: see `.env.example` (PINs, ports, `TURN_URLS`, `TURN_SECRET`).

There is no unit-test suite in the repo. Verify changes by running a throwaway server (`--data=<tmp dir> --port=<free port>`) and driving the HTTP API / Socket.IO, and check UI in a browser at phone width (375px) for `/crew` and `/admin`.

## Layout

```
shared/types.ts            Snapshot, *View types, FxEvent, FX_EVENTS
server/index.ts            entry: .env, HTTPS (self-signed cert for LAN IPs) or --http, static dist/, tick loop
server/env.ts              loads .env before anything reads process.env (must stay the first import)
server/db.ts               schema, additive migrations, q.get/all/run helpers, tx()
server/game.ts             ALL game rules and mutations (single source of truth)
server/snapshot.ts         role-filtered snapshots (admin / operator / player)
server/routes.ts           HTTP API with role checks (as([...roles], handler))
server/realtime.ts         Socket.IO: auth, rooms, snapshot broadcast, fx events, body cam signaling relay
server/presence.ts         in-memory online / camera-on state (not persisted)
server/auth.ts             PIN login, player join codes, sessions
server/ice.ts              STUN/TURN config and short-lived TURN credentials
client/src/lib/game.ts     useGame(app, router): socket, snapshot, server clock, fx alerts, act() for commands
client/src/lib/bodycam.ts  WebRTC publisher (phone) and viewer (operator)
client/src/lib/sound.ts    Web Audio signals, vibration, iOS audio session, wake lock
client/src/views/          Operator.vue (+ operator/*), Admin.vue (+ admin/* tabs), Crew.vue, Print.vue, Home.vue
```

## Core invariants (do not break)

1. **The server is the only source of truth.** Clients never compute balances, statuses or rewards; they render the last snapshot. Socket.IO delivers state, it does not store it.
2. **Every mutation goes through `mutate()` in `game.ts`**: one SQLite transaction; `bus.emit('changed')` → `scheduleBroadcast()` pushes fresh snapshots; `fx(...)` effects are queued and emitted only after commit.
3. **Money only moves via the ledger** (`transactions`). Never update a balance number. Corrections are new rows (`kind = 'correction'`, `reverses_id`), never edits or deletes.
4. **Idempotency**: anything that pays or penalizes uses a unique `idem_key` (`INSERT OR IGNORE`) and/or a guarded `UPDATE … WHERE status = …`. Examples: loot reward `loot:<id>:<extract_seq>`, overdue damage `overdue:<expedition_player_id>`, monster hit `hit:<requestId>`, purchase `purchase:<requestId>` (the client generates `requestId` once per intended purchase).
5. **Humans confirm reality**: a QR scan only marks loot `found`; credits come only from the operator's EXTRACT. A player's return is confirmed by staff, never by a scan.
6. **Time**: all timestamps are epoch ms from the server. Clients use `serverNow` offset. Pause freezes play: on resume, active deadlines shift by the pause length. `tick()` (1 s) handles overdue detection and delayed message delivery.
7. **Roles are enforced on the server** (`routes.ts`, `realtime.ts`). Admin can do everything an operator can. Players can only claim loot, mark themselves returning, message the operator (with radio), and publish their own camera.
8. **Visibility**: events have `visibility` `all | staff | admin`; snapshots are filtered per role. Loot QR tokens are only exposed to admin (`GET /api/print`), never in operator/player snapshots.
9. **Safety first**: game effects must stay safe (walk, freeze, silence — no running, no physical contact, stay inside the plot). Emergency pause must always be one tap away in FIELD ADMIN.

## Game rules encoded in the code

- Mission: `draft → active ⇄ paused → ended`. Only one current mission (`kv.current_mission_id`).
- Expedition: operator/admin forms a group (max `crew_size`, default 4) → `preparing`; OPEN GATE → `active`, each member gets `exit_at` and `deadline_at`; completes automatically when every member who left is `returned`.
- Player expedition status: `ready → outside → returning → returned`, or `overdue` after the deadline (HP damage once per expedition; overdue players stay eligible for later expeditions). Emergency extraction sets `penalty_exempt` (no overdue damage).
- **Loot scanning is locked while an expedition is `active`** (`claimLoot` returns 423; `Snapshot.raidActive` disables the button). Scanning happens between expeditions.
- Health replaces the old credit penalties (the `penalties` table and `missions.overdue_penalty` are legacy, unused). Crew HP is 0..100 in `health`; every change is a row in `health_events` (`kind`: overdue | hit | medkit | admin) via `changeHp()`. Lateness costs `missions.overdue_damage`% (once per expedition, idem `overdue:<ep id>`). HP never regenerates; MEDKIT heals `effect_value`% and is refused at 100%; the admin can set HP. At 0% everyone gets a DOWN alert; nothing excludes the player automatically.
- Monsters (players with role `monster`) act on their own. They report contact with `POST /api/monster/hit` (only crew currently outside the gate; `requestId` idempotency plus a 10 s per-target cooldown); damage is `missions.monster_damage`%. The victim sees "Атака монстра" without the monster's name; only the admin sees who hit. Changing monster damage (e.g. 100% "rage" for the finale) is announced to every device. Monsters have no orders: their only channel is a private chat with the field admin (channel `relay`, hidden from the operator, never jammed), and they join the `monsters` socket room, not `crew`.
- Store items (`shop_items`, seeded per mission, editable by admin): `radio` (unlocks direct comms), `bodycam` (unlocks cameras), `medkit` (heals HP), `time_ext` (adds `effect_value` seconds to the next expedition), `scanner` and `extraction` (create pending requests fulfilled by the admin).
- Comms: before RADIO, admin → operator ("relay") and admin → crew ("system" notices) only (admin ⇄ monster chat is separate and always on); after RADIO, operator ⇄ players with optional delay; admin can jam (`comms_disabled`), which also blocks cameras.
- Body cams: player opts in on their phone; video + mic are **send-only** (the player never hears the operator). Operator switches channels in the monitor. Signaling only between a player socket and a staff socket.

## Conventions

- Match surrounding code: small focused functions, comments only where intent is non-obvious, English identifiers/comments.
- Validate input in `game.ts` with `int()` / `text()` helpers and throw `GameError(status, 'русское сообщение')`; the HTTP layer turns it into `{ error }`.
- Schema changes: add `CREATE TABLE IF NOT EXISTS` / additive `ALTER TABLE … ADD COLUMN` migrations in `db.ts` guarded by `PRAGMA table_info`; never drop or rename columns (live game databases must keep working).
- New store items: add to `DEFAULT_SHOP` in `game.ts` (existing missions receive them on startup via `seedShop`), handle the effect in `purchase()`, and add a blocker in `operator/StorePanel.vue`.
- New realtime effect: add the name to `FX_EVENTS` in `shared/types.ts`, emit with `fx(name, payload, ...targets)` inside a mutation, route it per app in the `useGame(app, router)` callback.
- Styling: CSS variables in `client/src/styles/theme.css`; mono font for terminal text, condensed sans for prose; phone-first hit targets (≥ 44px) on `/crew` and `/admin`; no gradients/SaaS cards; animations are decorative and respect `prefers-reduced-motion`.
- Do not commit `data/`, `.env`, `dist/`.

## Git workflow

Work on a feature branch and open a pull request against `main`; do not push to `main` directly. Commit after the change is verified (typecheck, build, and a run against a throwaway server).

## Gotchas

- Phones need HTTPS for camera/microphone; the self-signed cert must be accepted once per device. QR labels must be printed from the server's LAN/public address, not `localhost`.
- Mobile browsers block audio until a tap; `sound.ts` re-unlocks on every tap. Capturing the mic with voice processing switches Android into call mode — body cam audio constraints keep processing off on purpose.
- WebRTC `ontrack` fires once per track with the same stream — attach the stream once (see `CamFeed.vue`).
- Instant messages are announced in `insertMessage`; `tick()` only announces delayed ones (`deliver_at > created_at`). Announcing both causes duplicate alerts.
- `node:sqlite` prints an ExperimentalWarning on start; it is expected.
