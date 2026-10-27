import crypto from 'node:crypto';

/*
 * ICE servers for body cams. Without configuration only STUN is offered, which works inside one Wi-Fi.
 * With a TURN relay (coturn or a hosted service) video also works across the internet / mobile data.
 *
 *   TURN_URLS      comma-separated, e.g. turn:raid.example.ru:3478?transport=udp,turns:raid.example.ru:5349?transport=tcp
 *   TURN_SECRET    coturn "static-auth-secret": the server issues short-lived credentials (secret never leaves the server)
 *   TURN_USERNAME / TURN_PASSWORD   fixed credentials instead of TURN_SECRET (hosted services)
 *   STUN_URLS      optional, defaults to Google's public STUN; set to "none" to disable
 */

const TTL_SEC = 12 * 3600;
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function turnConfigured() {
  return list(process.env.TURN_URLS).length > 0 && !!(process.env.TURN_SECRET || process.env.TURN_USERNAME);
}

export function iceServers(label: string): RTCIceServerLike[] {
  const servers: RTCIceServerLike[] = [];
  const stun = process.env.STUN_URLS === 'none' ? [] : list(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302');
  if (stun.length) servers.push({ urls: stun });

  const turn = list(process.env.TURN_URLS);
  if (!turn.length) return servers;
  if (process.env.TURN_SECRET) {
    // coturn REST API scheme ("use-auth-secret"): username = expiry:label, credential = base64(HMAC-SHA1(secret, username)).
    const username = `${Math.floor(Date.now() / 1000) + TTL_SEC}:${label.replace(/[^A-Za-z0-9_-]/g, '')}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
  } else if (process.env.TURN_USERNAME) {
    servers.push({ urls: turn, username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD ?? '' });
  }
  return servers;
}

export interface RTCIceServerLike { urls: string[]; username?: string; credential?: string }
export const ICE_TTL_SEC = TTL_SEC;
