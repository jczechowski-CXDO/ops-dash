/**
 * Why a stale panel is stale, in the failure's own words.
 *
 * `Panel`'s stale state renders a warning alert reading "{source} data is 14
 * minutes old" and carries no field for the reason — `PanelState` is
 * `{ kind, source, fetchedAt }`. The age alone tells an operator that
 * something is wrong and nothing about what, which is the difference between a
 * panel they can act on and one they learn to ignore. So the reason is
 * rendered as the stale panel's first child, beneath the alert.
 *
 * It is a separate component rather than three inline ternaries so that all
 * three screens say it the same way, and so `reason === null` — every demo
 * render, where nothing is stale — is one well-tested branch that produces no
 * DOM at all and cannot move a baseline.
 *
 * The proper home for this is `PanelState.stale.reason`; `components/` belongs
 * to another agent and the request is in the report.
 */
export function StaleReason({ reason, testId }: { reason: string | null; testId: string }) {
  if (reason === null) return null;
  return (
    <div
      data-testid={testId}
      style={{ fontSize: 12, color: 'var(--text-secondary)', textWrap: 'pretty' }}
    >
      {reason}
    </div>
  );
}
