# Endpoint Central adapter fixtures

**Hand-built and redacted, not captured.** An EPC response about this estate carries real
hostnames, logged-on usernames and NetBIOS domain names — the live tenant's
`domain_netbios_name` alone names two real organisations. Fixtures in this repository are
committed and pushed, so they leave the machine even though the app does not.

These reproduce the **shapes** measured against the live tenant on 2026-09-20, with every
value replaced: `DEMO-*` for computers, `@example.com` for people, `DEMO-DOMAIN` for the
NetBIOS name.

What is faithfully reproduced, because each of these cost a measurement to learn:

- **The envelope.** Every response is `{ message_type, message_response, message_version,
  status }`, and a failure is `status: "error"` with `error_code` and `error_description`
  under **HTTP 200**. `epc-error.json` is that shape. It is not the same trap as an HTML
  page under 200 — this one is well-formed JSON, so `fetchJson` passes it through as data
  and only an envelope check catches it.
- **Paging by `total`, not by a link.** `message_response` carries `{ total, limit, page }`
  beside the rows and there is no `nextLink`. `computers-page1.json` declares `total: 5`
  and holds 3 rows, so the pager has to ask for a second page — the live estate is 213
  computers inside one 500-row page, which means **paging cannot be exercised against the
  real thing at all** and only a stub can prove it.
- **Timestamps are epoch milliseconds as a NUMBER**, not ISO strings, and two of the live
  213 computers carry none. `computers-page2.json` reproduces that.
- **`owner_email_id` is empty.** It is populated on 2 of 213 rows live, so the fixtures
  leave it blank and carry `agent_logged_on_users` instead — which is itself absent on 68
  of 213, hence the row with neither.
- **BitLocker is per-DRIVE.** 136 rows over 132 computers live, with `volume_type` 0 for
  the OS volume and 1 for data volumes. A computer with no row at all is *not scanned*,
  which is not the same as *not encrypted*.
