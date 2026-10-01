import { createApp } from './index.js';
import { serveDashboard } from './static.js';
import { createTokenSource } from './http/graphToken.js';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { graphConfigPath } from './http/graphToken.js';
import { authConfigPath } from './auth/credentials.js';

/**
 * The process.
 *
 * `index.ts` composes the chain; this starts it and stops it. The split is not
 * ceremony — every test in this repo builds the chain without ever binding a
 * port or arming a timer, and that is only possible because starting is a
 * separate act from composing.
 *
 * Milestone 3's first task, and the first time any of this has run as a process
 * rather than as a hand-run through vitest. Everything believed about the
 * long-lived behaviour until now was reasoned from the code.
 */

/** This file's own location, so the dashboard is found relative to the build
 *  rather than to whatever directory the process was started from — the same
 *  mistake the store path made. */
const HERE_DIST = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env['PORT'] ?? 4000);
/**
 * Where the SQLite file lives.
 *
 * An absolute default, not a bare filename. `createApp`'s default is
 * `'ops-dash.sqlite'`, which SQLite resolves against the process's working
 * directory — so starting the server from a different directory silently
 * creates a second, empty database and the dashboard comes up with no history
 * and no explanation. Found by starting it from `/tmp`.
 */
const DB_PATH = process.env['OPS_DASH_DB'] ?? join(homedir(), '.local', 'share', 'ops-dash', 'ops-dash.sqlite');
/**
 * All interfaces by default, so the dashboard opens from another machine.
 *
 * **This was `127.0.0.1` and John changed it deliberately**, to reach the
 * dashboard from his desktop. Recording the trade rather than the setting.
 *
 * **UPDATED with the auth seam, because this paragraph had gone stale in the
 * reassuring-to-read direction.** It used to say the API has no authentication
 * at all. That is now half false and the surviving half is the important one:
 *
 *   - **Writes are protected.** Every mutating route requires a session, and a
 *     route that declares no policy is refused before its handler runs.
 *   - **Reads are open, by decision and not by omission.** `/api/services`,
 *     `/api/incidents`, `/api/checks` and the liveness half of `/api/health`
 *     answer anyone who can route to this host — which is the estate's health,
 *     the incident log and every probe result. Each is marked `'public-read'`
 *     in `routes.ts` so it is a choice somebody wrote down.
 *   - The Graph certificate's subject and expiry are now redacted for an
 *     unauthenticated caller; that specific disclosure is closed.
 *
 * Acceptable on a trusted LAN, which is where this runs. Not acceptable the
 * moment this host is reachable from anywhere else, and the security review's
 * release list carries both the binding and the open reads as their own items.
 * `HOST=127.0.0.1` restores the old behaviour without a code change.
 */
const HOST = process.env['HOST'] ?? '0.0.0.0';

function log(line: string): void {
  process.stderr.write(`[ops-dash] ${new Date().toISOString()} ${line}\n`);
}

/** The pieces of the app a shutdown has to touch, and nothing else — so the
 *  sequence can be tested without binding a port or opening a database. */
export type Stoppable = {
  schedule: { stop: () => void };
  api: { close: () => Promise<unknown> };
  store: { close: () => void };
};

/**
 * Stop everything, in the order that matters, once.
 *
 * **Order.** Timers first, so no poll is mid-write. Then in-flight HTTP, so a
 * request already being served finishes rather than dying on the wire. Then the
 * database, last, because closing it while a poll is writing is how a WAL
 * acquires a torn tail.
 *
 * **Once.** Two Ctrl-Cs in quick succession would otherwise close the store
 * twice, and the second throws on an already-closed handle — turning a clean
 * exit into a stack trace for no reason. Nobody reads a stack trace on shutdown
 * and decides it was fine.
 *
 * **The store closes even if HTTP does not.** A hung connection must not leave
 * the database open, so the close runs in `finally` rather than after a
 * successful `then`.
 *
 * Extracted and exported for its own test: this ran correctly the first time,
 * which is exactly the kind of thing that stays correct only while someone is
 * watching it.
 */
export function createShutdown(app: Stoppable, log: (line: string) => void, exit: () => void) {
  let closing = false;
  return (signal: string): void => {
    if (closing) return;
    closing = true;
    log(`${signal} — stopping`);
    app.schedule.stop();
    void app.api
      .close()
      .catch((cause: unknown) => log(`http close failed: ${String(cause)}`))
      .finally(() => {
        app.store.close();
        log('stopped cleanly');
        exit();
      });
  };
}

async function main(): Promise<void> {
  // The Graph credential is optional. Without it m365 reports
  // `graph_unconfigured` and every other source polls normally — a missing
  // credential must not stop the six feeds that do not need one.
  const configured = existsSync(graphConfigPath());
  log(configured ? 'graph credential found' : 'no graph credential — m365 will read unconfigured');

  // The directory may not exist on a first run, and SQLite will not create it.
  mkdirSync(dirname(DB_PATH), { recursive: true });
  /**
   * Read the certificate fresh on every health request, not once at startup.
   *
   * Swapping a cert that is about to expire is the normal operation here, and
   * a value captured at boot would keep reporting the old expiry until somebody
   * restarted — which is precisely the moment nobody is watching. Reading a
   * small file per health request is cheap; being wrong about when our own
   * credential dies is not.
   *
   * Returns `undefined` rather than throwing when there is no credential:
   * unconfigured is not a failure, and must not render as one.
   */
  const graphCert = (): string | undefined => {
    const path = graphConfigPath();
    if (!existsSync(path)) return undefined;
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as { cert_pem?: unknown };
    return typeof cfg.cert_pem === 'string' ? readFileSync(cfg.cert_pem, 'utf8') : undefined;
  };

  const app = createApp({
    dbPath: DB_PATH,
    graphCert,
    ...(configured ? { tokens: createTokenSource() } : {}),
  });
  log(`store at ${DB_PATH}`);

  // Listen BEFORE polling. The first poll round takes a second or two against
  // seven real feeds, and a dashboard that refuses connections while it warms
  // up looks exactly like a dashboard that has crashed.
  // The built SPA, from the same process, so there is one URL to open. Absent
  // build → the route says so rather than 404ing as if the path were wrong.
  // server/dist/main.js -> server/dist -> server -> repo root, then web/dist.
  const webDist = resolve(HERE_DIST, '..', '..', 'web', 'dist');
  serveDashboard(app.api, webDist);
  log(existsSync(join(webDist, 'index.html')) ? `serving the dashboard from ${webDist}` : `no dashboard build at ${webDist} — run npm run build`);

  await app.api.listen({ port: PORT, host: HOST });
  log(`listening on http://${HOST}:${PORT}`);
  // Said at every start, not buried in a comment. A server exposed on a network
  // interface is a decision, and a decision nobody is reminded of becomes an
  // assumption.
  //
  // UPDATED with the auth seam. The old line said "NO AUTHENTICATION"
  // unconditionally, which stopped being true the moment writes were protected —
  // and a startup banner that is wrong in the REASSURING direction is the thing
  // this repo treats as worst, but one that is wrong in the alarming direction
  // is only slightly better: an operator who learns the warning overstates its
  // case stops reading it, and then does not read the day it is right.
  //
  // So both states name what is actually open rather than what is missing, and
  // the unconfigured one names the fix, which the old line could not.
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    const credentialed = existsSync(authConfigPath());
    log(
      credentialed
        ? `bound to ${HOST}. Reads are OPEN on this network by decision; every write needs a session. Set HOST=127.0.0.1 for loopback only.`
        : `WARNING: bound to ${HOST} with NO OPERATOR CREDENTIAL — reads are open to anyone who can reach this host, and every write will be REFUSED until one exists. Run: npm run auth:set`,
    );
  }

  app.schedule.start();
  log(`polling ${app.sources.length} sources`);

  const shutdown = createShutdown(app, log, () => process.exit(0));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => shutdown(signal));
  }

  // The poller catches everything and the API returns errors as data, so
  // reaching either of these means a bug somewhere neither covers. Log it
  // loudly and keep running: a monitoring tool that exits on an unexpected
  // error is one that stops watching exactly when something unusual happened.
  process.on('unhandledRejection', (reason) => log(`UNHANDLED REJECTION — this is a bug: ${String(reason)}`));
  process.on('uncaughtException', (err) => log(`UNCAUGHT EXCEPTION — this is a bug: ${err.stack ?? String(err)}`));
}

main().catch((cause: unknown) => {
  log(`failed to start: ${String(cause)}`);
  process.exit(1);
});
