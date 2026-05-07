import { initDb } from './db.js';
import { init as initBroadcaster } from './broadcaster.js';
import { start as startServer } from './server.js';
import { start as startMonitor, stop as stopMonitor } from './monitor.js';
import config from './config.js';

console.log('[main] Starting uptime monitor...');

initDb();
console.log('[main] Database initialized');

initBroadcaster();
console.log(`[main] WebSocket server on port ${config.WS_PORT}`);

startServer();
console.log(`[main] HTTP server on port ${config.HTTP_PORT}`);

startMonitor();

function shutdown() {
  console.log('[main] Shutting down...');
  stopMonitor();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
