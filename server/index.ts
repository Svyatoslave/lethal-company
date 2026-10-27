import './env.js';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';
import { DATA_DIR, arg } from './db.js';
import { pins } from './auth.js';
import { tick } from './game.js';
import { api } from './routes.js';
import { attachRealtime } from './realtime.js';
import { turnConfigured } from './ice.js';

const HTTPS_PORT = Number(arg('port') ?? process.env.PORT ?? 8443);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
/** Behind a TLS-terminating proxy (cloudflared, nginx, Caddy) run plain HTTP on PORT. */
const HTTP_ONLY = process.env.HTTP_ONLY === '1' || process.argv.includes('--http');

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/** Self-signed certificate covering localhost and every LAN IP: phones need HTTPS for camera access. */
function certificate() {
  const ips = lanAddresses();
  const meta = path.join(DATA_DIR, 'cert.json');
  if (fs.existsSync(meta)) {
    const saved = JSON.parse(fs.readFileSync(meta, 'utf8')) as { ips: string[]; key: string; cert: string };
    if (ips.every((ip) => saved.ips.includes(ip))) return saved;
  }
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'operation-last-night.local' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  const saved = { ips, key: pems.private, cert: pems.cert };
  fs.writeFileSync(meta, JSON.stringify(saved));
  return saved;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', HTTP_ONLY);
app.use(express.json({ limit: '32kb' }));
app.use('/api', api);

const clientDir = fileURLToPath(new URL('../dist', import.meta.url));
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. Run "npm run build" or use the Vite dev server.'));
}

let server: http.Server | https.Server;
if (HTTP_ONLY) {
  server = http.createServer(app);
} else {
  const { key, cert } = certificate();
  server = https.createServer({ key, cert }, app);
  // Plain HTTP only redirects, so QR links and typed addresses always land on the secure origin.
  http
    .createServer((req, res) => {
      const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
      res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url ?? '/'}` }).end();
    })
    .listen(HTTP_PORT)
    .on('error', () => console.warn(`[warn] HTTP redirect port ${HTTP_PORT} unavailable`));
}

attachRealtime(server);
setInterval(tick, 1000);

server.listen(HTTPS_PORT, () => {
  const proto = HTTP_ONLY ? 'http' : 'https';
  const line = '─'.repeat(58);
  console.log(`\n${line}\n  OPERATION: LAST NIGHT — NIGHT RAID  ·  server online\n${line}`);
  for (const host of ['localhost', ...lanAddresses()]) console.log(`  ${proto}://${host}:${HTTPS_PORT}`);
  console.log(`${line}\n  FIELD ADMIN PIN : ${pins.adminPin}\n  OPERATOR PIN    : ${pins.operatorPin}`);
  console.log(`  BODY CAM RELAY  : ${turnConfigured() ? `TURN ${process.env.TURN_URLS}` : 'not configured (cameras work inside one network)'}`);
  console.log(`  (change in ${path.join(DATA_DIR, 'secrets.json')} or ADMIN_PIN / OPERATOR_PIN env)\n${line}\n`);
});
