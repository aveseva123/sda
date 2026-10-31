// Tiny HTTP router with JSON helpers. No dependencies.
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && r.method !== '*') continue;
      const m = pathname.match(r.re);
      if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { handler: r.handler, params }; }
    }
    return null;
  }
}

export function readBody(req, { limit = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Слишком большое тело запроса')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Некорректный JSON'); }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

export function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const u = new URL(req.url, 'http://x');
  return u.searchParams.get('token') || req.headers['x-api-token'] || null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

export function serveStatic(root, urlPath, res) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}
