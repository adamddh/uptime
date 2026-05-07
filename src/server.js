import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from './config.js';
import { handleRequest } from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

export function start() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${config.HTTP_PORT}`);
    const pathname = url.pathname;
    const params = url.searchParams;

    if (pathname.startsWith('/api/')) {
      handleRequest(req, res, pathname, params);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveStatic(res, path.join(DASHBOARD_DIR, 'index.html'));
      return;
    }

    if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
      const safe = pathname.replace(/\.\./g, '');
      serveStatic(res, path.join(DASHBOARD_DIR, safe));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(config.HTTP_PORT, '127.0.0.1', () => {
    console.log(`[server] Dashboard at http://localhost:${config.HTTP_PORT}`);
  });

  server.on('error', (err) => console.error('[server] Error:', err));
  return server;
}
