import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { certExpiry, certNeedsAttention, CERT_WARN_DAYS, CERT_CRITICAL_DAYS } from './certExpiry.js';

/**
 * Throwaway certificates, generated at runtime into a temp directory.
 *
 * Copied deliberately from `http/graphToken.test.ts`: `guards.test.ts` forbids a
 * certificate block anywhere in source, so a committed fixture would mean either
 * weakening that guard or keeping a certificate in git history forever. These
 * are real X.509 structures, so the dates below come out of a parser rather than
 * out of a stub that agrees with the code.
 */
let DIR: string;
/** Valid from roughly now, for 400 days. */
let LONG: string;
/** Already expired: valid from two days ago until yesterday. */
let DEAD: string;
/** Not yet valid: begins in 30 days. */
let FUTURE: string;

const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
/** Both ends given explicitly. `-days` counts from *now* even when
 *  `-not_before` is in the past, so an "expired" certificate built with
 *  `-days 1` comes out valid for another day — which produced a `critical`
 *  where the test wanted `expired`, and is exactly why the validity window is
 *  read back from the parsed certificate below rather than assumed. */
const makeCert = (name: string, fromDays: number, toDays: number): string => {
  const keyPath = join(DIR, `${name}.key`);
  const certPath = join(DIR, `${name}.crt`);
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-not_before', isoToOpenssl(fromDays), '-not_after', isoToOpenssl(toDays),
    '-subj', '/CN=ops-dash-retention-test']);
  // Key and certificate concatenated, which is the shape the real file has —
  // the function must find the certificate block inside it.
  return readFileSync(keyPath, 'utf8') + readFileSync(certPath, 'utf8');
};
/** The same, with notAfter given as an absolute openssl timestamp. */
const makeCertUntil = (name: string, notAfter: string): string => {
  const keyPath = join(DIR, `${name}.key`);
  const certPath = join(DIR, `${name}.crt`);
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-not_before', isoToOpenssl(0), '-not_after', notAfter, '-subj', '/CN=ops-dash-retention-test']);
  return readFileSync(keyPath, 'utf8') + readFileSync(certPath, 'utf8');
};
/** openssl wants YYYYMMDDHHMMSSZ: no dashes, no colons, no 'T', no fraction. */
function isoToOpenssl(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z');
}

beforeAll(() => {
  DIR = mkdtempSync(join(tmpdir(), 'ops-dash-certexp-'));
  LONG = makeCert('long', 0, 400);
  DEAD = makeCert('dead', -2, -1);
  FUTURE = makeCert('future', 30, 400);
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); });

/** The certificate's own notAfter, read independently of the function under
 *  test, so no assertion below reaches the date by the same path the code did. */
const notAfterMs = (pem: string) => Date.parse(new X509Certificate(pem).validTo);
const DAY = 24 * 60 * 60 * 1000;

describe('the arithmetic, against a real certificate', () => {
  it('reports the days remaining, counted down from the certificate itself', () => {
    const e = certExpiry(LONG, notAfterMs(LONG) - 200 * DAY - 1000);
    expect(e.level).toBe('ok');
    if (e.level === 'unreadable') throw new Error('unreachable');
    expect(e.daysLeft).toBe(200);
    expect(e.msLeft).toBe(200 * DAY + 1000);
    expect(e.notAfter).toBe(new Date(notAfterMs(LONG)).toISOString());
  });

  it('truncates toward the past rather than rounding up', () => {
    // 29.9 days left must read 29. Rounding up is how a deadline is missed by a
    // day, and it is the boundary between `critical` and `warn`.
    const e = certExpiry(LONG, notAfterMs(LONG) - (30 * DAY - 1));
    if (e.level === 'unreadable') throw new Error('unreachable');
    expect(e.daysLeft).toBe(29);
  });
});

describe('the levels', () => {
  const at = (daysBeforeExpiry: number) => certExpiry(LONG, notAfterMs(LONG) - daysBeforeExpiry * DAY);

  it('is ok well clear of the warning window', () => {
    expect(at(CERT_WARN_DAYS + 1).level).toBe('ok');
    expect(at(365).level).toBe('ok');
  });

  it('warns from 90 days out, inclusive', () => {
    expect(at(CERT_WARN_DAYS).level).toBe('warn');
    expect(at(CERT_CRITICAL_DAYS + 1).level).toBe('warn');
  });

  it('is critical from 30 days out, inclusive', () => {
    expect(at(CERT_CRITICAL_DAYS).level).toBe('critical');
    expect(at(1).level).toBe('critical');
  });

  it('is expired at the instant notAfter passes, not a day later', () => {
    expect(certExpiry(LONG, notAfterMs(LONG)).level).toBe('expired');
    expect(certExpiry(LONG, notAfterMs(LONG) + 1).level).toBe('expired');
    expect(certExpiry(LONG, notAfterMs(LONG) - 1).level).toBe('critical');
  });

  it('reports a genuinely expired certificate as expired, with a negative age', () => {
    // Not a clock trick: this certificate really is past its notAfter now.
    const e = certExpiry(DEAD);
    expect(e.level).toBe('expired');
    if (e.level === 'unreadable') throw new Error('unreachable');
    expect(e.msLeft).toBeLessThan(0);
  });

  it('reports a certificate that has not started yet as not-yet-valid, never ok', () => {
    // A credential installed early, or a clock wrong by a month. It cannot
    // authenticate, so reading `ok` would be the wrong-green in miniature.
    expect(certExpiry(FUTURE).level).toBe('not-yet-valid');
  });

  it('every level except ok asks for attention', () => {
    expect(certNeedsAttention(certExpiry(LONG, notAfterMs(LONG) - 365 * DAY))).toBe(false);
    expect(certNeedsAttention(at(CERT_WARN_DAYS))).toBe(true);
    expect(certNeedsAttention(at(1))).toBe(true);
    expect(certNeedsAttention(certExpiry(DEAD))).toBe(true);
    expect(certNeedsAttention(certExpiry(FUTURE))).toBe(true);
    expect(certNeedsAttention(certExpiry('rubbish'))).toBe(true);
  });
});

describe('what it does with input it cannot read', () => {
  it('reports unreadable rather than throwing, for junk', () => {
    // This runs inside a health route. A throw there hides the very fact it was
    // added to surface, and "we cannot read our own credential" must reach the
    // screen as a problem.
    const e = certExpiry('not a certificate');
    expect(e.level).toBe('unreadable');
    if (e.level !== 'unreadable') throw new Error('unreachable');
    expect(e.reason.length).toBeGreaterThan(0);
  });

  it('reports unreadable for a private key with no certificate in it', () => {
    // The combined file minus its certificate half. A parser that shrugged at
    // this would report a valid credential from a file containing none.
    const keyOnly = readFileSync(join(DIR, 'long.key'), 'utf8');
    expect(certExpiry(keyOnly).level).toBe('unreadable');
  });

  it('reports unreadable for the empty string', () => {
    expect(certExpiry('').level).toBe('unreadable');
  });

  it('accepts an already-parsed X509Certificate and agrees with the PEM', () => {
    const clock = notAfterMs(LONG) - 100 * DAY;
    expect(certExpiry(new X509Certificate(LONG), clock)).toEqual(certExpiry(LONG, clock));
  });
});

describe('a certificate with the real credential\'s expiry date', () => {
  // Not the real certificate — a throwaway one generated with the same notAfter
  // the security review addendum records, 2028-08-09. So the dates below are a
  // parsed X.509 validity window, not arithmetic this test did to itself, and
  // the assertions are the answers the watcher will actually give on those days.
  let GRAPHLIKE: string;
  beforeAll(() => { GRAPHLIKE = makeCertUntil('graphlike', '20280809000000Z'); });

  const on = (y: number, m: number, d: number) => certExpiry(GRAPHLIKE, Date.UTC(y, m - 1, d)).level;

  it('is ok in 2027 and walks down warn -> critical -> expired as the date arrives', () => {
    expect(new X509Certificate(GRAPHLIKE).validTo, 'the fixture must really expire then')
      .toContain('2028');
    expect(on(2027, 6, 1)).toBe('ok');
    expect(on(2028, 6, 1)).toBe('warn');       // 69 days out
    expect(on(2028, 7, 20)).toBe('critical');  // 20 days out
    expect(on(2028, 8, 10)).toBe('expired');
  });
});
