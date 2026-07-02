import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { loadEnv } from './env.js';
import { DATA_FILE, refreshData } from './fetch-data.js';

loadEnv();

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = resolve(ROOT_DIR, 'public');
const PORT = Number(process.env.PORT || 5173);
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

let refreshPromise = null;

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') return '';
  const trimmed = basePath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

function normalizeRequest(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (BASE_PATH && pathname === BASE_PATH) {
    pathname = `${BASE_PATH}/`;
  }

  if (BASE_PATH && pathname.startsWith(`${BASE_PATH}/`)) {
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }

  return { pathname };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

async function serveStatic(request, response) {
  const { pathname } = normalizeRequest(request);
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, 'Not found');
  }
}

const server = createServer(async (request, response) => {
  try {
    const { pathname } = normalizeRequest(request);

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/data') {
      try {
        const content = await readFile(DATA_FILE, 'utf8');
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch {
        sendJson(response, 404, {
          error: 'Данные ещё не скачаны. Нажмите "Обновить" или выполните npm run fetch.'
        });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/refresh') {
      if (!refreshPromise) {
        refreshPromise = refreshData().finally(() => {
          refreshPromise = null;
        });
      }

      const data = await refreshPromise;
      sendJson(response, 200, {
        ok: true,
        generatedAt: data.generatedAt,
        universeCount: data.universes.length,
        failureCount: data.failures.length
      });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed');
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`OGame RU Dashboard: http://localhost:${PORT}${BASE_PATH || '/'}`);
});
