import { createApp } from './index.js';
import { createTokenSource } from './http/graphToken.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { graphConfigPath } from './http/graphToken.js';

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
/** Loopback by default, and deliberately not `0.0.0.0`. The API has no auth —
 *  `/api/health` says `auth: { mode: 'none' }` out loud — so binding it to
 *  anything reachable would publish the estate's health to the network. The
 *  security review's release list has this as its own item; the default is the
 *  safe one and an operator has to mean it to change it. */
const HOST = process.env['HOST'] ?? '127.0.0.1';

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
  const app = createApp({ dbPath: DB_PATH, ...(configured ? { tokens: createTokenSource() } : {}) });
  log(`store at ${DB_PATH}`);

  // Listen BEFORE polling. The first poll round takes a second or two against
  // seven real feeds, and a dashboard that refuses connections while it warms
  // up looks exactly like a dashboard that has crashed.
  await app.api.listen({ port: PORT, host: HOST });
  log(`listening on http://${HOST}:${PORT}`);

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
