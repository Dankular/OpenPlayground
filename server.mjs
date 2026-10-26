import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const root = resolve(process.env.DIST_DIR || 'dist');
const assets = resolve(process.env.ASSET_DIR || 'public/local-assets');
const uploadKey = process.env.ASSET_UPLOAD_TOKEN || '';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'video/webm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.svg': 'image/svg+xml', '.shader': 'text/plain', '.glsl': 'text/plain', '.obj': 'text/plain', '.txt': 'text/plain' };
const authorized = value => {
  if (!uploadKey || typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(`Bearer ${uploadKey}`);
  return a.length === b.length && timingSafeEqual(a, b);
};
const inside = (base, name) => {
  const path = resolve(base, name.replace(/^[/\\]+/, ''));
  return path.startsWith(base + sep) && !name.split(/[/\\]/).some(part => part.startsWith('.')) ? path : null;
};
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/healthz') {
      const catalog = await stat(resolve(assets, 'catalog.json')).then(() => true, () => false);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ status: 'ok', assets: catalog })); return;
    }
    if (request.method === 'PUT' && path.startsWith('/_deploy/assets/')) {
      if (!authorized(request.headers.authorization)) { response.writeHead(404); response.end(); return; }
      const target = inside(assets, path.slice('/_deploy/assets/'.length));
      const length = Number(request.headers['content-length']);
      const expected = request.headers['x-asset-sha256'];
      if (!target || !Number.isSafeInteger(length) || length < 0 || length > 100 * 1024 * 1024 || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) { response.writeHead(400); response.end(); return; }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.upload`;
      let bytes = 0; const hash = createHash('sha256');
      request.on('data', data => { bytes += data.length; hash.update(data); if (bytes > length) request.destroy(); });
      try {
        await pipeline(request, createWriteStream(temporary, { flags: 'wx' }));
        if (bytes !== length || hash.digest('hex') !== expected) throw new Error('Incomplete upload');
        await rename(temporary, target); response.writeHead(201, { ETag: `"${expected}"` }); response.end();
      } catch { await unlink(temporary).catch(() => {}); if (!response.destroyed) { response.writeHead(400); response.end(); } }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const isAsset = path.startsWith('/local-assets/');
    let file = inside(isAsset ? assets : root, isAsset ? path.slice('/local-assets/'.length) : path === '/' ? 'index.html' : path);
    if (!file) { response.writeHead(403); response.end(); return; }
    let info = await stat(file).catch(() => null);
    if (!info?.isFile() && !isAsset && !extname(path)) { file = resolve(root, 'index.html'); info = await stat(file).catch(() => null); }
    if (!info?.isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', mime[extname(file).toLowerCase()] || 'application/octet-stream');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    let start = 0, end = info.size - 1;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(end, Number(range[2])) : end;
      if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
      response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    response.setHeader('Content-Length', info.size ? end - start + 1 : 0);
    if (request.method === 'HEAD' || !info.size) response.end();
    else { const stream = createReadStream(file, { start, end }); response.on('close', () => stream.destroy()); stream.on('error', () => response.destroy()); stream.pipe(response); }
  } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`OpenPlayground server ready on ${server.address().port}`));
