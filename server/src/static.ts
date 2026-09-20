import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Serve the built dashboard from the same process that serves the API.
 *
 * Without this the server runs perfectly and there is nothing to open: the API
 * answers on :4400 and the SPA lives in a separate Vite process, so "it is
 * running" and "you can look at it" were two different states. One process, one
 * URL, no proxy to configure and no second thing to remember to start.
 *
 * Registered from the composition root rather than inside `api/`, because
 * whether this process also serves a UI is a deployment decision and the API
 * module should not have an opinion about it. `api/` stays a pure JSON surface
 * and its read-only guard is unaffected — everything here is GET.
 *
 * No new dependency. `@fastify/static` would do this and more, and this is
 * forty lines of `createReadStream` against a budget the repo has kept closed
 * since Milestone 1.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a request path to a file inside `root`, or `undefined`.
 *
 * The traversal check is the whole point and it compares RESOLVED paths, not
 * the request string: `..%2f..%2fetc%2fpasswd` and `/./../../etc/passwd` both
 * look harmless before resolution and neither is. Anything that lands outside
 * `root` — or is a directory, or does not exist — is refused here rather than
 * being opened and found wanting.
 */
export function resolveAsset(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return undefined;   // a malformed escape is not a path we serve
  }
  if (decoded.includes('\0')) return undefined;
  const candidate = resolve(join(root, normalize(decoded)));
  const base = resolve(root);
  if (candidate !== base && !candidate.startsWith(base + sep)) return undefined;
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
  return candidate;
}

export function serveDashboard(app: FastifyInstance, root: string): void {
  const index = join(root, 'index.html');

  /**
   * The SPA catch-all, and it **declares its policy** like every other route.
   *
   * `'public-read'` is the truth here: the dashboard's HTML, JS and fonts are
   * served to anyone who can reach the port, by the same decision that leaves
   * the read API open. Saying so is not ceremony — `server/src/auth/session.ts`
   * refuses a route that declares no policy with a 500 **before its handler
   * runs**, so an undeclared route is fail-closed rather than quietly open.
   *
   * This route was invisible to that machinery in both directions, which is the
   * reason the line is here. `buildApi` wraps the API in `register`, so those
   * routes boot at `ready()` and a later `onRoute` hook still sees them;
   * `serveDashboard` calls `app.get` directly on the root instance, so it
   * registers immediately and a hook added afterwards never fires for it.
   * `m4-auth` found their route-table guard reporting **seven routes where the
   * process serves eight** — a guard blind to the exact route it was written to
   * catch, reporting green. It surfaced only because they pinned the expected
   * list as literals; `expect(rows.length).toBeGreaterThan(6)` would have passed
   * forever.
   *
   * With the policy declared, `registerAuth` can move to the root instance and
   * cover anything registered on it later. **That move belongs to `m4-auth` and
   * must come after this line** — the hook refuses undeclared routes, so moving
   * it first makes the SPA 500 on every request.
   */
  app.get('/*', { config: { auth: 'public-read' } }, (request, reply) => {
    const url = request.url;

    // `/api/*` is never a file. Handled before the lookup so a stray file in
    // dist could not shadow a route, and so an unknown API path answers as an
    // API — JSON 404 — rather than silently returning the SPA shell, which a
    // fetch would then fail to parse and report as a transport error.
    if (url === '/api' || url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'no such route' });
    }

    const file = resolveAsset(root, url);
    if (file) {
      return reply
        .type(TYPES[extname(file)] ?? 'application/octet-stream')
        .send(createReadStream(file));
    }

    // Client-side routes — `/services/m365`, `/incidents/INC-1234` — are not
    // files and must return the shell so the router can render them. A 404 here
    // would break every deep link and every page refresh.
    if (!existsSync(index)) {
      return reply.code(503).send({ error: 'the dashboard has not been built; run npm run build' });
    }
    return reply.type(TYPES['.html']!).send(createReadStream(index));
  });
}
