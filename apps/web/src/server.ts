import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The OpenNodes web app server: serves the editor (the same files as the public demo
 * in `docs/`) and forwards `/api` and `/health` to the API, so the browser talks to one
 * origin. `/config.js` switches the editor from demo simulation to the real API.
 */

export interface WebServerOptions {
  /** Directory with index.html, app.js, … (the repository's `docs/`). */
  root: string;
  /** Where the API listens, e.g. http://localhost:4000. */
  apiUrl: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
};

/** Hop-by-hop headers must not be forwarded by a proxy (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function forward(req: http.IncomingMessage, res: http.ServerResponse, apiUrl: string): void {
  const target = new URL(req.url ?? '/', apiUrl);
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k) && v !== undefined) headers[k] = v;
  }
  headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';
  const upstream = http.request(target, { method: req.method, headers }, (up) => {
    const out: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (!HOP_BY_HOP.has(k) && v !== undefined) out[k] = v;
    }
    res.writeHead(up.statusCode ?? 502, out);
    up.pipe(res); // streams, so the run event stream (SSE) works through the proxy
  });
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        code: 'ERR_API_UNREACHABLE',
        message: `The OpenNodes API at ${apiUrl} is not reachable. Is it running?`,
      })
    );
  });
  req.pipe(upstream);
}

async function serveFile(
  root: string,
  pathname: string,
  res: http.ServerResponse
): Promise<boolean> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) return false; // path traversal
  if (rel.split('/').some((part) => part.startsWith('.'))) return false; // dotfiles
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      // The editor is a handful of small modules; always revalidate so updates show.
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export function createWebServer(options: WebServerOptions): http.Server {
  const root = resolve(options.root);
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/') || pathname.startsWith('/health/')) {
      return forward(req, res, options.apiUrl);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end();
    }
    if (pathname === '/config.js') {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end("window.OPENNODES = { api: '/api/v1' };\n");
    }
    if (await serveFile(root, pathname, res)) return;
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = process.env.WEB_ROOT ?? resolve(here, '../../../docs');
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  createWebServer({ root, apiUrl }).listen(port, host, () => {
    console.log(
      `OpenNodes web on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} → API ${apiUrl}`
    );
  });
}
