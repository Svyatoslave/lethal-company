import express, { type Request, type Response } from 'express';
import * as g from './game.js';
import { actorFor, join, login, logout } from './auth.js';
import { playerSnapshot, staffSnapshot } from './snapshot.js';
import type { Role } from '../shared/types.js';

type Handler = (req: Request, actor: g.Actor) => unknown;

function bearer(req: Request) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function send(res: Response, fn: () => unknown) {
  try {
    res.json(fn() ?? { ok: true });
  } catch (e) {
    if (e instanceof g.GameError) res.status(e.status).json({ error: e.message });
    else {
      console.error(e);
      res.status(500).json({ error: 'SYSTEM FAULT' });
    }
  }
}

/** Wraps a handler with server-side role checks. Admin may do everything an operator can. */
function as(roles: Role[], fn: Handler) {
  return (req: Request, res: Response) => {
    const actor = actorFor(bearer(req));
    if (!actor) return void res.status(401).json({ error: 'Требуется авторизация' });
    const ok = roles.includes(actor.role) || (actor.role === 'admin' && roles.includes('operator'));
    if (!ok) return void res.status(403).json({ error: 'Недостаточно прав' });
    send(res, () => fn(req, actor));
  };
}

const ADMIN: Role[] = ['admin'];
const STAFF: Role[] = ['operator'];
const ANY: Role[] = ['admin', 'operator', 'player'];

export const api = express.Router();

// auth
api.post('/auth/login', (req, res) => send(res, () => login(req.body?.role, req.body?.pin, req.ip ?? '')));
api.post('/auth/join', (req, res) => send(res, () => join(req.body?.code, req.ip ?? '')));
api.post('/auth/logout', (req, res) => send(res, () => logout(bearer(req))));
api.get('/auth/me', as(ANY, (_req, a) => a));
api.get('/state', as(ANY, (_req, a) =>
  a.role === 'player' ? playerSnapshot(a.playerId!) : staffSnapshot(a.role as 'admin' | 'operator')));

// missions
api.post('/missions', as(ADMIN, (req, a) => g.createMission(req.body ?? {}, a)));
api.patch('/missions/current', as(ADMIN, (req, a) => g.updateMission(req.body ?? {}, a)));
api.post('/missions/current/start', as(ADMIN, (_req, a) => g.startMission(a)));
api.post('/missions/current/pause', as(ADMIN, (req, a) => g.pauseMission(req.body?.reason, a)));
api.post('/missions/current/resume', as(ADMIN, (_req, a) => g.resumeMission(a)));
api.post('/missions/current/end', as(ADMIN, (_req, a) => g.endMission(a)));

// players
api.post('/players', as(ADMIN, (req, a) => g.addPlayer(req.body?.callsign, req.body?.role, a)));
api.patch('/players/:id', as(ADMIN, (req, a) => g.updatePlayer(req.params.id, req.body ?? {}, a)));
api.delete('/players/:id', as(ADMIN, (req, a) => g.removePlayer(req.params.id, a)));

// expeditions
api.post('/expeditions', as(STAFF, (req, a) => g.formExpedition(req.body?.playerIds, a)));
api.post('/expeditions/current/add', as(STAFF, (req, a) => g.addToExpedition(req.body?.playerId, a)));
api.post('/expeditions/current/remove', as(STAFF, (req, a) => g.removeFromExpedition(req.body?.playerId, a)));
api.post('/expeditions/current/exit', as(STAFF, (req, a) => g.markExit(req.body?.playerId, a)));
api.post('/expeditions/current/return', as(STAFF, (req, a) => g.confirmReturn(req.body?.playerId, a)));
api.post('/expeditions/current/returning', as(ANY, (req, a) =>
  g.markReturning(a.role === 'player' ? a.playerId : req.body?.playerId, a)));
api.post('/expeditions/current/status', as(ADMIN, (req, a) => g.correctStatus(req.body?.playerId, req.body?.status, a)));
api.post('/expeditions/current/complete', as(ADMIN, (_req, a) => g.forceCompleteExpedition(a)));

// gate
api.post('/gate/open', as(STAFF, (_req, a) => g.openGate(a)));
api.post('/gate/closing', as(STAFF, (_req, a) => g.gateClosing(a)));
api.post('/gate/close', as(STAFF, (_req, a) => g.closeGate(a)));

// loot
api.post('/loot/:token/claim', as(['player'], (req, a) => g.claimLoot(req.params.token, a)));
api.post('/loot/:id/extract', as(STAFF, (req, a) => g.extractLoot(req.params.id, a)));
api.post('/loot/:id/undo', as(ADMIN, (req, a) => g.undoExtraction(req.params.id, a)));
api.post('/loot/:id/reset', as(ADMIN, (req, a) => g.resetLoot(req.params.id, a)));
api.post('/loot', as(ADMIN, (req, a) => g.createLoot(req.body ?? {}, a)));
api.post('/loot/import', as(ADMIN, (req, a) => g.importLoot(req.body?.list, a)));
api.patch('/loot/:id', as(ADMIN, (req, a) => g.updateLoot(req.params.id, req.body ?? {}, a)));
api.delete('/loot/:id', as(ADMIN, (req, a) => g.deleteLoot(req.params.id, a)));
api.get('/print', as(ADMIN, () => ({ loot: g.lootForPrint(), players: staffSnapshot('admin').players })));

// store & economy
api.post('/shop/:itemId/purchase', as(STAFF, (req, a) => g.purchase(req.params.itemId, req.body ?? {}, a)));
api.patch('/shop/:itemId', as(ADMIN, (req, a) => g.updateShopItem(req.params.itemId, req.body ?? {}, a)));
api.post('/purchases/:id/scanner', as(ADMIN, (req, a) => g.answerScanner(req.params.id, req.body?.hint, a)));
api.post('/purchases/:id/extraction', as(ADMIN, (req, a) => g.emergencyExtraction(req.params.id, a)));
api.post('/economy/adjust', as(ADMIN, (req, a) => g.manualAdjust(req.body?.amount, req.body?.reason, a)));
api.post('/economy/:txId/reverse', as(ADMIN, (req, a) => g.reverseTransaction(req.params.txId, req.body?.reason, a)));
api.post('/penalties/:id/cancel', as(ADMIN, (req, a) => g.cancelPenalty(req.params.id, a)));

// comms
api.post('/messages', as(ANY, (req, a) => g.sendMessage(req.body ?? {}, a)));

// threat & events
api.post('/admin/threat', as(ADMIN, (req, a) => g.setThreatLevel(req.body?.level, a)));
api.post('/admin/monster', as(ADMIN, (req, a) => g.monsterAction(req.body ?? {}, a)));
api.post('/admin/events', as(ADMIN, (req, a) => g.customEvent(req.body ?? {}, a)));

api.use((_req, res) => void res.status(404).json({ error: 'Not found' }));
