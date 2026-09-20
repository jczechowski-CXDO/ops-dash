import { X509Certificate } from 'node:crypto';

/**
 * How long the Graph certificate has left.
 *
 * Security review addendum, item 17: the app registration authenticates with a
 * certificate that expires on a date nothing in this process knows or watches.
 * When it goes, the M365 tile turns `unknown` with an auth error — honest, and
 * nobody is watching the tile that says the watcher is broken. A monitoring tool
 * whose own credential dies quietly is this product's thesis turned on itself.
 *
 * **The PEM is a parameter and the path is not in this file.** No default, no
 * `readFileSync`, no config lookup: `web/src/guards.test.ts` forbids a
 * credential path or a certificate block anywhere in source, and the caller —
 * which already holds the config it loaded from `OPS_DASH_GRAPH_CONFIG` — is the
 * only thing that should know where the file is. This module takes a string and
 * a clock and does arithmetic, which is also why it can be tested exhaustively
 * against a throwaway certificate generated at runtime.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Warn at 90 days, critical at 30.
 *
 * Renewing this is not a command: a new key and certificate are generated,
 * uploaded to the app registration in Entra by someone with the rights to do it,
 * and the file on disk is swapped — and the certificate presently in use was
 * issued for roughly two years, so the warning will fire exactly once and must
 * survive being ignored for a while. Ninety days is a quarter: long enough that
 * the renewal can wait for whoever does it to be back from leave, short enough
 * that it is not noise for eighteen months. Thirty days is the point at which
 * this is no longer a reminder.
 */
export const CERT_WARN_DAYS = 90;
export const CERT_CRITICAL_DAYS = 30;

export type CertLevel =
  /** Beyond the warning window. */
  | 'ok'
  /** Inside 90 days. Plan the renewal. */
  | 'warn'
  /** Inside 30 days. Do it now. */
  | 'critical'
  /** `notAfter` has passed. Graph is refusing our assertions as of that instant. */
  | 'expired'
  /** `notBefore` is in the future — a certificate installed early, or a clock
   *  wrong by enough to matter. Not usable yet, and must not read as `ok`. */
  | 'not-yet-valid'
  /** The PEM did not parse, or carried no certificate. Reported rather than
   *  thrown, because "we cannot read our own credential" is a fact this thing
   *  exists to surface, and a throw inside a health route hides it. */
  | 'unreadable';

export type CertExpiry =
  | { level: 'unreadable'; reason: string }
  | {
      level: Exclude<CertLevel, 'unreadable'>;
      /** ISO. The certificate's own `notAfter`, not a value we computed. */
      notAfter: string;
      notBefore: string;
      msLeft: number;
      /** Whole days remaining, truncated toward the past: 29.9 days left is 29,
       *  never 30, because rounding up is how a deadline gets missed by a day.
       *  Negative once expired. */
      daysLeft: number;
      subject: string;
    };

/** True when the level means somebody has to do something. Exported so callers
 *  agree on where the line is instead of each writing their own comparison. */
export const certNeedsAttention = (e: CertExpiry): boolean => e.level !== 'ok';

/**
 * Judge a certificate against a clock.
 *
 * Accepts a PEM string (the combined key+certificate file is fine — `notBefore`
 * and `notAfter` come from the certificate block) or an already-parsed
 * `X509Certificate`, so a caller that has one need not serialise it back.
 */
export function certExpiry(pem: string | X509Certificate, now: Date | number = new Date()): CertExpiry {
  const nowMs = typeof now === 'number' ? now : now.getTime();

  let cert: X509Certificate;
  try {
    cert = typeof pem === 'string' ? new X509Certificate(pem) : pem;
  } catch (cause) {
    return { level: 'unreadable', reason: cause instanceof Error ? cause.message : String(cause) };
  }

  const notAfterMs = Date.parse(cert.validTo);
  const notBeforeMs = Date.parse(cert.validFrom);
  if (Number.isNaN(notAfterMs) || Number.isNaN(notBeforeMs)) {
    // A certificate whose dates we cannot read is not one we can vouch for.
    // Explicitly NOT 'ok' — an unparseable date compared with `<` is false, and
    // falling through would report an indefinitely valid credential.
    return { level: 'unreadable', reason: `unparseable validity window: ${cert.validFrom} .. ${cert.validTo}` };
  }

  const msLeft = notAfterMs - nowMs;
  const daysLeft = Math.floor(msLeft / DAY_MS);
  const common = {
    notAfter: new Date(notAfterMs).toISOString(),
    notBefore: new Date(notBeforeMs).toISOString(),
    msLeft,
    daysLeft,
    subject: cert.subject,
  };

  // Ordered worst-first, and `expired` is tested before `not-yet-valid` so a
  // certificate that is somehow both (a zero-length window) reads as the more
  // alarming of the two.
  if (msLeft <= 0) return { level: 'expired', ...common };
  if (nowMs < notBeforeMs) return { level: 'not-yet-valid', ...common };
  if (msLeft <= CERT_CRITICAL_DAYS * DAY_MS) return { level: 'critical', ...common };
  if (msLeft <= CERT_WARN_DAYS * DAY_MS) return { level: 'warn', ...common };
  return { level: 'ok', ...common };
}
