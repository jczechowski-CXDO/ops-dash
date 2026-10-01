# Email adapter fixtures — hand-built, and that is the whole point

These two files are **written by hand**. No live Control Panel payload was pasted
into either of them, and none ever may be.

This directory is the one place in the repository where the two halves of the
redaction rule meet head-on, and they point in opposite directions:

- **The live page renders real subjects and real recipient addresses by design.**
  That is what the Email screen is for. An operator investigating a phishing run
  needs the actual sender and the actual subject line.
- **Fixtures are committed and pushed, so they leave the machine.** A real
  subject line is somebody's mail; a real recipient is somebody's address; a real
  phishing sender is somebody's actual infrastructure. None of it belongs in git,
  where `git log -p` keeps it forever.

Both are true at once and the seam between them is here. So:

- Recipients are `@example.com` (RFC 2606).
- Senders are the **fabricated** hostile domains already established by
  `web/src/fixtures/email.ts` and named in the allowlist in
  `web/src/guards.test.ts` — `invoice-secure.net`, `ms-verify.co`,
  `sharefile-cloud.ru`, `exarnple.com`. No new hostile domain is invented here,
  deliberately: every one of them has to be a name somebody decided to allow,
  and a registrable domain in a public repo is a liability whoever owns it.
  `exarnple.com` is a homoglyph of `example.com` and is the fixture doing its
  job, not a typo.
- Every IP is in `203.0.113.0/24` (RFC 5737).
- Every hostname is under a documentation domain.

The numbers are hand-computed rather than copied, so that a test can pin a
literal that was never produced by the code under test:

| fixture | figure | by hand |
|---|---|---|
| `statistics-by-type.json` | `processed` | `emails_total` = **10000** |
| `statistics-by-type.json` | `blocked` | spam 500 + rejected 6 + threat 90 + content 0 + advthreat 4 = **600** |
| `statistics-by-type.json` | all categories | 8200 + 1200 + 500 + 0 + 90 + 4 + 6 + 0 + 0 = 10000, which equals `emails_total`, so a faithful payload produces **no** degrade note |
| `search-blocked.json` | rows | **4**, newest first |

The *shapes* are faithful to the live API and were confirmed against it on
2026-09-20 — the field names, the nesting of `classification`/`status`, the
`date` format with no fractional seconds, and the fact that `data[]` in the
statistics response is **name-keyed and of varying length** (one live window
returned nine categories, the window before it returned ten).

`search-blocked.json` deliberately carries a `reason` from each of the three
groups the adapter treats differently: `phishing` and `spam content` map onto
the contract's vocabulary, `bad url reputation` maps onto `Malicious URL`, and
`bad ip reputation` has no contract equivalent and passes through verbatim.
A fixture where every row mapped cleanly could not tell a working mapping from
one that dropped the pass-through case.
