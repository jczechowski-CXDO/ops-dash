#!/usr/bin/env node
/**
 * Write `~/.config/ops-dash/auth.json` — the dashboard's single operator credential.
 *
 * **Why this exists rather than a documented one-liner.** Nobody should be asked
 * to hand-assemble a scrypt hash, its salt and its cost parameters into JSON.
 * Every failure mode is silent — wrong encoding, a salt that is not the one the
 * hash was made with, a parameter transposed — and all of them present
 * identically as "my password does not work", with no way to tell which.
 *
 * **It writes the file through the same code that reads it.** `hashPassword` is
 * imported from `auth/credentials.js`, not reimplemented here. A writer with its
 * own idea of the format is the seam defect this project keeps paying for, in
 * the one place whose symptom is "authentication silently fails".
 *
 * **The password never appears in argv.** argv lands in shell history and is
 * visible in `ps` to every user on the box. It is read from the terminal with
 * echo off, and confirmed, because a mistyped password you cannot see is a
 * credential file you have to rewrite.
 */
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIST = new URL('../dist/auth/credentials.js', import.meta.url);
let credentials;
try {
  credentials = await import(DIST.href);
} catch {
  console.error('The server is not built. Run `npm run build:server` first.');
  process.exit(1);
}
const { hashPassword, authConfigPath } = credentials;

/**
 * A line queue, because the interactive and piped paths behave differently and
 * both have to work.
 *
 * Two earlier versions failed on a pipe while working perfectly when typed at.
 * Creating one interface per question discards the buffered remainder when the
 * first closes; a single interface still fires `close` at EOF before the second
 * question is asked, so the callback never runs and the script hangs on an
 * unsettled await. Neither is visible unless you test the non-TTY path — which
 * is the path CI and any scripted use take, and the reason this was tested by
 * piping rather than only by typing.
 *
 * So: consume lines as they arrive, and let `prompt` take from the queue or wait
 * for the next one. Echo is suppressed only on a real terminal, since there is
 * nothing to suppress on a pipe.
 */
const TTY = process.stdin.isTTY === true;
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: TTY });

const lines = [];
let waiting = null;
let ended = false;
rl.on('line', (line) => {
  if (waiting) { const w = waiting; waiting = null; w(line); }
  else lines.push(line);
});
rl.on('close', () => {
  ended = true;
  if (waiting) { const w = waiting; waiting = null; w(null); }
});

let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = (str) => { if (!muted) write(str); };

function prompt(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden && TTY;
  const finish = (line) => {
    if (muted) process.stdout.write('\n');
    muted = false;
    if (line === null) {
      process.stdout.write('\n');
      console.error('Input ended before an answer was given. Nothing written.');
      process.exit(1);
    }
    return line;
  };
  if (lines.length) return Promise.resolve(finish(lines.shift()));
  if (ended) return Promise.resolve(finish(null));
  return new Promise((resolve) => { waiting = (line) => resolve(finish(line)); });
}

const path = authConfigPath(process.env);
const force = process.argv.includes('--force');

if (existsSync(path) && !force) {
  console.error(`Refusing to overwrite an existing credential at:\n  ${path}\n`);
  console.error('Re-run with --force if you mean to replace it. Note that replacing');
  console.error('session_key signs every existing session out, which is the only');
  console.error('way to revoke one.');
  rl.close();
  process.exit(1);
}

const username = (await prompt('Username: ')).trim();
if (!username) { console.error('A username is required.'); rl.close(); process.exit(1); }

const password = await prompt('Password (not shown): ', { hidden: true });
if (password.length < 12) {
  // Not a policy, a threat model. This box binds 0.0.0.0 by John's ruling, so
  // the login route is reachable by anyone on the LAN, and scrypt's ~50ms is
  // the only throttle there is.
  console.error('\nToo short. This host is reachable on the network and has no');
  console.error('login rate limit, so the password is the whole of the defence.');
  console.error('Use at least 12 characters.');
  rl.close();
  process.exit(1);
}
const again = await prompt('Password again: ', { hidden: true });
if (password !== again) { console.error('\nThey do not match. Nothing written.'); rl.close(); process.exit(1); }

mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
writeFileSync(
  path,
  `${JSON.stringify({
    username,
    password_hash: hashPassword(password),
    session_key: randomBytes(32).toString('hex'),
  }, null, 2)}\n`,
  { mode: 0o600 },
);
// Explicit, because writeFileSync's mode is masked by umask on some systems and
// the server REFUSES to authenticate anyone from a file that is not 600.
chmodSync(path, 0o600);

console.log(`\nWrote ${path} (mode 600).`);
console.log('Restart the server to pick it up. Nothing else needs setting.');
rl.close();
