import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Yalnız geliştirme: gerçekçi mod snapshot sayfası.
 *  - /dev/realistic-snapshots?phase=N → dev/realistic-snapshots.html
 *  - POST /__realistic/save {phase, name, kind, data} → samples/realistic/phase<N>/<name>
 * Üretim derlemesine girmez (configureServer yalnız dev sunucusunda çalışır).
 */
function realisticSnapshots(): Plugin {
  return {
    name: 'realistic-snapshots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/dev/realistic-snapshots' || url.startsWith('/dev/realistic-snapshots?')) {
          req.url = '/dev/realistic-snapshots.html' + url.slice('/dev/realistic-snapshots'.length);
          return next();
        }
        if (url !== '/__realistic/save' || req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { phase, name, kind, data } = JSON.parse(body);
            // Faz 1..9 → phase<N>; düzeltme turları ve demo / bakış mesafesi adla (ör. 'fix-v2', 'demo')
            const named = typeof phase === 'string' && /^(fix-v\d+|demo|view-distance|view-v\d+|scale-switch|packing)$/.test(phase);
            if (!named && (!Number.isInteger(phase) || phase < 1 || phase > 9)) throw new Error('geçersiz faz');
            if (typeof name !== 'string' || !/^[a-z0-9_-]+\.(png|json)$/.test(name)) throw new Error('geçersiz dosya adı');
            const dir = resolve(server.config.root, 'samples', 'realistic', named ? phase : `phase${phase}`);
            mkdirSync(dir, { recursive: true });
            const out = join(dir, name);
            if (kind === 'png') {
              const m = /^data:image\/png;base64,(.+)$/.exec(data);
              if (!m) throw new Error('PNG data URL bekleniyor');
              writeFileSync(out, Buffer.from(m[1], 'base64'));
            } else {
              writeFileSync(out, String(data));
            }
            res.statusCode = 200;
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end((e as Error).message);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), realisticSnapshots()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any);
