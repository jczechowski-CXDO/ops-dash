/**
 * Stringify a thrown value that may be actively hostile to being stringified.
 *
 * `String((cause as Error)?.message ?? cause)` throws on a null-prototype
 * object, on a Proxy with a throwing trap, and on anything whose `toString` or
 * `message` getter throws. That matters far more than it sounds, because the
 * coercion runs **inside a catch block**: the new exception escapes the handler
 * that was supposed to contain it, and every `catch` in this server exists
 * precisely to stop one failure taking the process down.
 *
 * Shared rather than written twice. It was fixed in the poller first and the
 * identical line survived in `fetchJson`, which is the more exposed of the two —
 * `CLAUDE.md` now states "it never throws" as an unconditional invariant of that
 * helper, and an invariant with an exception nobody has found is worse than one
 * with an exception everybody knows about.
 */
export function describeThrown(cause: unknown): string {
  try {
    if (cause instanceof Error && typeof cause.message === 'string') return cause.message;
    const message = (cause as { message?: unknown } | null | undefined)?.message;
    if (typeof message === 'string') return message;
    return String(cause);
  } catch {
    // Nothing about the value can be trusted, including its type tag.
    return 'unstringifiable thrown value';
  }
}
