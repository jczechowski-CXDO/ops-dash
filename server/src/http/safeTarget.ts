/**
 * Is this a URL this process is allowed to fetch?
 *
 * The SSRF floor, in one place, applied to **every** URL we dial — including
 * the ones a redirect chose for us. `vendors.json`'s validator checked the URL
 * we typed; this checks the URL we are about to open, which is a different
 * question the moment `redirect: 'follow'` is in play.
 *
 * Scoped honestly: today nothing listens on this machine and the process reads
 * five public status feeds, so the realistic worst case is that a compromised
 * vendor makes us issue one GET a minute at `127.0.0.1` and reads the answer
 * out of a local SQLite file. That is a real capability and a small one. On the
 * day this runs on a server on the corp VLAN it is a textbook SSRF primitive
 * with the response body retrievable through `/api/services` — and the code
 * will not change on that day. So it changes now, while it is cheap.
 *
 * Parsed, not pattern-matched. `startsWith('https://')` is satisfied by
 * `https://attacker@127.0.0.1/`, by `https://127.0.0.1#.example.com`, and by
 * every host this file exists to refuse.
 */

/** The reason a target was refused, or `undefined` if it is allowed. Returning
 *  the reason rather than a boolean so the caller can put it in an error code
 *  the operator will actually see. */
export type Refusal = { code: string; message: string };

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localdomain'];

export function refuseTarget(raw: string): Refusal | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { code: 'bad_url', message: 'not a parseable absolute URL' };
  }

  if (url.protocol !== 'https:') {
    return { code: 'not_https', message: `refused ${url.protocol}//… — https only` };
  }

  // Credentials in a URL are never something we meant to send, and they are the
  // classic way to make a hostile URL read like a friendly one.
  if (url.username || url.password) {
    return { code: 'url_credentials', message: 'refused a URL carrying credentials' };
  }

  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { code: 'private_target', message: `refused ${host} — not a public host` };
  }

  // An IP literal is never one of our five status feeds. This is deliberately
  // stricter than "block the private ranges": a public literal has no business
  // here either, and refusing the whole shape removes a class of bypass rather
  // than a list of addresses.
  const literal = ipLiteral(host);
  if (literal) {
    return { code: 'private_target', message: `refused the ${literal} literal ${host} — feeds are named hosts` };
  }

  return undefined;
}

/**
 * Is this hostname an IP literal, and which kind?
 *
 * DNS is NOT resolved here, and that is a stated limit rather than an
 * oversight: a name that resolves to 127.0.0.1 still passes, and DNS rebinding
 * between this check and the socket is not something a userland check can win.
 * What this removes is the direct path — the hop that a `Location:` header can
 * take for free. The complete answer is a socket-level check, and it is on the
 * "Reopens at release" list where it belongs.
 */
function ipLiteral(host: string): 'IPv6' | 'IPv4' | undefined {
  // `new URL()` normalises an IPv6 host to bracketed form.
  if (host.startsWith('[')) return 'IPv6';
  // Four dotted decimal parts. Also catches the octal/hex-looking forms, which
  // `parseInt` would otherwise wave through with a different value.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return 'IPv4';
  // A bare integer is a valid IPv4 address to most resolvers: 2130706433 is
  // 127.0.0.1. `new URL()` normalises some of these, but not on every runtime.
  if (/^\d+$/.test(host)) return 'IPv4';
  return undefined;
}
