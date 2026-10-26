import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const types: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'video/webm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain', '.shader': 'text/plain', '.glsl': 'text/plain', '.obj': 'text/plain' };

function serveExtractedAssets(server: ViteDevServer | PreviewServer) {
      const root = resolve(server.config.root, 'public/local-assets');
      // Vite's cached public-file inventory normally relies on filesystem
      // watchers. Serve generated assets directly so newly extracted files are
      // visible without watching all 36,000+ objects or restarting the server.
      server.middlewares.use('/local-assets', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        let path: string;
        try { path = resolve(root, decodeURIComponent((request.url ?? '').split('?')[0]).replace(/^[/\\]+/, '')); }
        catch { response.statusCode = 400; response.end(); return; }
        if (!path.startsWith(root + sep)) { response.statusCode = 403; response.end(); return; }
        let size: number;
        try { const stat = statSync(path); if (!stat.isFile()) return next(); size = stat.size; }
        catch { response.statusCode = 404; response.end(); return; }
        response.setHeader('Content-Type', types[extname(path).toLowerCase()] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Accept-Ranges', 'bytes');
        let start = 0, end = Math.max(0, size - 1);
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        if (range) {
          start = Number(range[1]); end = range[2] ? Math.min(end, Number(range[2])) : end;
          if (start > end || start >= size) { response.statusCode = 416; response.setHeader('Content-Range', `bytes */${size}`); response.end(); return; }
          response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        response.setHeader('Content-Length', size ? end - start + 1 : 0);
        if (request.method === 'HEAD' || !size) { response.end(); return; }
        const stream = createReadStream(path, { start, end });
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response);
      });
}

export default defineConfig(({ mode }) => ({
  build: { copyPublicDir: mode === 'standalone' },
  plugins: [{ name: 'live-extracted-assets', configureServer: serveExtractedAssets, configurePreviewServer: serveExtractedAssets }],
  server: {
    watch: {
      // Static extraction produces tens of thousands of files. They are served
      // directly; only browser source needs HMR watching.
      ignored: ['**/research/**', '**/.venv/**', '**/public/local-assets/**', '**/scripts/**'],
    },
  },
}));
