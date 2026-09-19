/**
 * Vendor-supplied URLs (`ServiceStatus.vendor.url`, `VendorIncident.url`) are the
 * only externally-authored values that ever become an `href`. Anything but https
 * is dropped rather than sanitised — we have no use for a vendor link that is not
 * https, and "sanitise" is how these bugs come back.
 *
 * Written in Milestone 1 although nothing calls it yet, so Milestone 2 has no
 * excuse: the first adapter that renders a vendor link has the check waiting for
 * it. A `javascript:` URL in an href executes on click, and a local-only app is
 * still a browser.
 */
export function safeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'https:' ? parsed.toString() : undefined;
}
