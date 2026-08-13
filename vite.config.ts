import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

/**
 * Serves schemas/ at /schemas: GET list, GET file, PUT <schema>.layout.json.
 *
 * `schemas/` is gitignored, so a fresh clone — and every new worktree — starts
 * without one, and each fs call here has to survive its absence:
 *
 * - **A missing directory is an empty listing, not an error.** `sources.ts`
 *   already reads no-listing as "no local schemas" rather than a failure, so
 *   throwing contradicts the client for nothing — and a throw in a sync
 *   middleware becomes a full-screen Vite overlay that blocks the canvas.
 * - **A layout PUT creates the directory on the way in.** Layouts are saved
 *   for remote schemas too, so `schemas/` may legitimately hold nothing but
 *   them, and no earlier step would have made it.
 *
 * The PUT is the one that bites hardest. Its write runs in the request's `end`
 * handler, so a throw there is asynchronous: it does not fail one request, it
 * takes the dev server down. Hence no fs call below is left to throw — the
 * async ones (write, read stream) answer with a status instead.
 */
function serveSchemas(): Plugin {
  const dir = path.resolve(import.meta.dirname, 'schemas');
  const fail = (res: ServerResponse, code: number, error: string): void => {
    res.statusCode = code;
    res.end(JSON.stringify({ error }));
  };
  return {
    name: 'serve-schemas',
    configureServer(server) {
      server.middlewares.use('/schemas', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, ''));
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && name === '') {
          const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
          res.end(
            JSON.stringify(files.filter((f) => f.endsWith('.json') && !f.endsWith('.layout.json'))),
          );
          return;
        }
        const file = path.join(dir, name);
        if (name === '' || !file.startsWith(dir + path.sep)) {
          fail(res, 404, 'not found');
          return;
        }
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) {
            fail(res, 404, 'not found');
            return;
          }
          const stream = fs.createReadStream(file);
          // the file can go while it is being read; whether anything has been
          // sent yet decides between a status and simply stopping
          stream.on('error', () => {
            if (res.headersSent) res.end();
            else fail(res, 500, `cannot read ${name}`);
          });
          stream.pipe(res);
          return;
        }
        if (req.method === 'PUT' && name.endsWith('.layout.json')) {
          let body = '';
          req.on('data', (c) => {
            body += c;
          });
          req.on('end', () => {
            try {
              JSON.parse(body);
            } catch {
              fail(res, 400, 'invalid JSON');
              return;
            }
            try {
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n');
            } catch (err) {
              fail(res, 500, `cannot write ${name}: ${(err as Error).message}`);
              return;
            }
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Relative, so a build runs from any path without being told which — a
  // GitHub Pages project site lives at /<repo>/, and hardcoding that would
  // make the build repo-specific. Vite serves the dev server from / either
  // way, so `import.meta.env.BASE_URL` is "/" in dev and "./" in the build.
  base: './',
  plugins: [react(), serveSchemas()],
});
