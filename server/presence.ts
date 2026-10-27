// Live, non-persistent device state: which players have a socket open and which are streaming a body cam.

const sockets = new Map<number, number>();
const cams = new Map<number, number>();

const bump = (map: Map<number, number>, id: number, d: number) => map.set(id, Math.max(0, (map.get(id) ?? 0) + d));

export const presence = {
  connected: (playerId: number) => bump(sockets, playerId, 1),
  disconnected: (playerId: number) => bump(sockets, playerId, -1),
  camStarted: (playerId: number) => bump(cams, playerId, 1),
  camStopped: (playerId: number) => bump(cams, playerId, -1),
  isOnline: (playerId: number) => (sockets.get(playerId) ?? 0) > 0,
  isCamOn: (playerId: number) => (cams.get(playerId) ?? 0) > 0,
};
