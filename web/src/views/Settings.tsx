import { useState, type CSSProperties, type ReactNode } from 'react';
import type { AlertRule, Integration } from '@ops-dash/shared';
import { Card } from '../components/Card.js';
import { SectionHeading } from '../components/SectionHeading.js';
import { Panel, type PanelState } from '../components/Panel.js';
import { Switch } from '../components/aurora/Switch.js';
import { ageLabel } from '../theme/ageLabel.js';
import { useDemoMode } from '../app/DemoModeProvider.js';

/**
 * README § 7 "Rules & integrations".
 *
 *   Two columns, `repeat(auto-fit, minmax(320px,1fr))`, gap 16, `align-items: start`.
 *   Integrations list: rows of `1fr auto`, padding `11px 16px`, bottom divider.
 *   Name 13px/700 over 11.5px secondary detail; right side a status pill
 *   (radius 999, padding `3px 9px`, 11px/700) using `--success-lighter`/
 *   `--success-dark`, `--info-lighter`/`--info-dark`, `--warning-lighter`/
 *   `--warning-dark`.
 *   Alert rules list: same row shape, right side an Aurora `Switch`. Each
 *   rule's threshold is the secondary line.
 *
 * Rule toggles are local state in Milestone 1 — nothing persists and nothing is
 * written anywhere. Milestone 4 replaces `useState` with the real setting.
 */

/**
 * Total over `Integration['state']`: adding a state stops this compiling rather
 * than rendering a pill with no colour. `error` gets the token pair the README's
 * list stops short of, because the contract's union includes it.
 *
 * **One rung pair for all four states: `-darker` on `-lighter`.** README § 7
 * specifies `-dark` on `-lighter`, and that pairing does not clear WCAG AA at
 * 11px/700. Measured in Chromium against the production build, `document.fonts
 * .ready` awaited, background resolved by ancestor walk (need 4.5):
 *
 *            README `-dark` on `-lighter`      this file, `-darker` on `-lighter`
 *            light        dark                 light        dark
 *   success  5.53         5.49                 10.54        6.87
 *   info     4.65         5.60                  9.57        6.78
 *   warning  4.09 FAIL    5.73                  8.91        6.75
 *   error    5.50         4.81                 11.79        6.68
 *
 * Only `warning` failed, and `warning` is the needs-auth pill — the row that
 * explains why the m365 tile is Unknown. It is fixed by moving the whole map one
 * rung rather than special-casing one state: four states treated as one system
 * is the entire point of this table, a mixed rung leaves the next state added
 * with no rule to follow, and `info` at 4.65 was a rounding error from failing
 * too. The worst pair in the table is now 6.68. Both values are published
 * Aurora tokens; no literal and no hand-picked colour enters this file.
 *
 * jsdom cannot resolve `var()`, so no test below proves those ratios — what the
 * tests pin is the invariant that produced them: every state pairs `-darker`
 * with `-lighter` of the same family, and no two states share a family.
 */
const PILL: Record<Integration['state'], { bg: string; fg: string }> = {
  connected: { bg: 'var(--success-lighter)', fg: 'var(--success-darker)' },
  polling: { bg: 'var(--info-lighter)', fg: 'var(--info-darker)' },
  needs_auth: { bg: 'var(--warning-lighter)', fg: 'var(--warning-darker)' },
  error: { bg: 'var(--error-lighter)', fg: 'var(--error-darker)' },
};

const row: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 12,
  padding: '11px 16px',
  borderBottom: '1px solid var(--divider)',
};

const nameStyle: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' };
const detailStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 };

/** A consequence line, not a second detail: it exists only when there is
 *  something an operator would otherwise have to infer. It takes the same
 *  `-darker` rung as the pills, for the same reason — on `--background-paper`,
 *  `--warning-dark` measured 4.61:1 in light, clearing AA by 0.11, which is
 *  noise; `--warning-darker` measures 10.03 light / 13.50 dark. */
const noteStyle: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: 'var(--warning-darker)',
  marginTop: 3,
};

function List({ children }: { children: ReactNode }) {
  // The last row's divider is the card's own border; `overflow: hidden` on the
  // card clips it, matching the prototype's flush list.
  return <div style={{ marginBottom: -1 }}>{children}</div>;
}

function IntegrationRow({ integration }: { integration: Integration }) {
  const pill = PILL[integration.state];
  // `lastSuccessAt` is optional and genuinely absent on the feed that has never
  // authenticated. That absence is the finding, so it is rendered as an absence
  // — not as an age, and never as the unknown-age sentinel, which would read as
  // a measurement we do not have.
  const lastSuccessAt = integration.lastSuccessAt;

  return (
    <div style={row} data-testid="integration-row">
      <div>
        <div style={nameStyle}>{integration.name}</div>
        <div style={detailStyle}>{integration.detail}</div>
        <div style={detailStyle}>
          {lastSuccessAt
            ? `Last success ${ageLabel(lastSuccessAt)} ago`
            : 'Never connected · this feed has not authenticated once'}
        </div>
        {lastSuccessAt ? null : (
          <div style={noteStyle}>
            Until it does, everything it would report stays Unknown — no rule can fire on it, and
            anything it would have caught has to be found by hand.
          </div>
        )}
      </div>
      <span
        data-testid="integration-state"
        style={{
          justifySelf: 'end',
          borderRadius: 999,
          padding: '3px 9px',
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          background: pill.bg,
          color: pill.fg,
        }}
      >
        {integration.stateLabel}
      </span>
    </div>
  );
}

function RuleRow({
  rule,
  enabled,
  onChange,
}: {
  rule: AlertRule;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div style={row} data-testid="rule-row">
      <div>
        <div style={nameStyle}>{rule.name}</div>
        <div style={detailStyle}>{rule.detail}</div>
        {enabled ? null : (
          // A rule that is off is not a blank in the list; it is the reason a
          // matching condition produced no alert. INC-2288 exists precisely
          // because this one is off and someone found it by hand.
          <div style={noteStyle}>Off — nothing alerts on this; matches are found by hand.</div>
        )}
      </div>
      <Switch checked={enabled} onChange={onChange} aria-label={rule.name} />
    </div>
  );
}

export default function Settings({
  rules: rulesProp,
  integrations: integrationsProp,
}: {
  rules?: AlertRule[];
  integrations?: Integration[];
} = {}) {
  const { bundle } = useDemoMode();
  const rules = rulesProp ?? bundle.rules;
  const integrations = integrationsProp ?? bundle.integrations;

  // Local, unpersisted, and keyed by rule so a reorder cannot shift the flags.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isEnabled = (rule: AlertRule) => overrides[rule.key] ?? rule.enabled;
  const enabledCount = rules.filter(isEnabled).length;

  const integrationsState: PanelState =
    integrations.length === 0
      ? { kind: 'empty', message: 'No integrations are configured. Nothing is being collected.' }
      : { kind: 'ready' };

  const rulesState: PanelState =
    rules.length === 0
      ? { kind: 'empty', message: 'No alert rules are configured. Nothing will open an incident.' }
      : { kind: 'ready' };

  return (
    <div
      data-testid="view-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div
        data-testid="settings-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeading
            meta={
              <span data-testid="integrations-count">
                {integrations.length} configured
              </span>
            }
          >
            Integrations
          </SectionHeading>
          <Card padding="0" style={{ overflow: 'hidden' }}>
            <Panel state={integrationsState}>
              <List>
                {integrations.map((integration) => (
                  <IntegrationRow key={integration.key} integration={integration} />
                ))}
              </List>
            </Panel>
          </Card>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeading
            meta={
              // Derived from the same predicate the switches render, every
              // render — not a constant that agrees with them today.
              <span data-testid="rules-count">{`${enabledCount} of ${rules.length} enabled`}</span>
            }
          >
            Alert rules
          </SectionHeading>
          <Card padding="0" style={{ overflow: 'hidden' }}>
            <Panel state={rulesState}>
              <List>
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.key}
                    rule={rule}
                    enabled={isEnabled(rule)}
                    onChange={(next) =>
                      setOverrides((prev) => ({ ...prev, [rule.key]: next }))
                    }
                  />
                ))}
              </List>
            </Panel>
          </Card>
        </section>
      </div>
    </div>
  );
}
