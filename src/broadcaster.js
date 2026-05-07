import { WebSocketServer } from 'ws';
import config from './config.js';

let wss;
const clients = new Set();

export function init() {
  if (wss) return;
  wss = new WebSocketServer({ host: '127.0.0.1', port: config.WS_PORT });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  wss.on('error', (err) => console.error('[ws] Error:', err));
}

export function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(msg, (err) => { if (err) clients.delete(client); });
    }
  }
}

export function clientCount() {
  return clients.size;
}

export function close() {
  if (wss) { wss.close(); wss = null; }
  clients.clear();
}
