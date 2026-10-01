import type { ReactNode } from 'react';
import { Icon } from './Icon.js';
// IconName lives in the generated module; Icon.tsx consumes it without
// re-exporting it, and Icon.tsx is Wave 0's file and not ours to change.
import type { IconName } from './icons.generated.js';
import { srOnly } from '../../theme/srOnly.js';

// Ported from _ds_bundle.js lines 2563-2686 (variant="soft"). Dropped: the
// outlined and filled variants, severity="primary", onClose, action, custom
// icon, className/style/rest passthrough.
//
// The bundle's leading glyph is a Material Symbols ligature ('check_circle',
// 'info', 'warning', 'error') rendered through class="material-symbols-rounded".
// That font is not vendored — no network at runtime — so the ligature mechanism
// is genuinely unavailable and the bundle's icon code is dropped.
//
// M-7 corrects an overstatement in the previous version of this comment, which
// claimed no suitable glyph existed. Two of the eleven extracted glyphs do fit:
// 'task_alt' is a check-in-circle and 'report' is an exclamation-in-octagon. The
// accurate statement is narrower: there is a good glyph for success, a good
// glyph for warning and error, and NONE for info.
//
// Severity must not be hue-only — that fails in greyscale and for colour-blind
// users — so severity is carried three ways: a 3px left accent in the severity's
// main token (matching the alert-row treatment in README "Screens / views"), the
// glyph where one exists, and a severity word that is always present for
// assistive technology. What remains uncovered, stated plainly: warning and
// error share the 'report' glyph and are told apart visually by hue alone.

/** null where none of the eleven extracted glyphs fits. See the note above. */
const SEV: Record<
  'success' | 'info' | 'warning' | 'error',
  { fill: string; content: string; main: string; icon: IconName | null }
> = {
  success: {
    fill: 'var(--alert-successfill, var(--success-lighter))',
    content: 'var(--alert-successcontent, var(--success-darker))',
    main: 'var(--success-main)',
    icon: 'task_alt',
  },
  info: {
    fill: 'var(--alert-infofill, var(--info-lighter))',
    content: 'var(--alert-infocontent, var(--info-darker))',
    main: 'var(--info-main)',
    icon: null,
  },
  warning: {
    fill: 'var(--alert-warningfill, var(--warning-lighter))',
    content: 'var(--alert-warningcontent, var(--warning-darker))',
    main: 'var(--warning-main)',
    icon: 'report',
  },
  error: {
    fill: 'var(--alert-errorfill, var(--error-lighter))',
    content: 'var(--alert-errorcontent, var(--error-darker))',
    main: 'var(--error-main)',
    icon: 'report',
  },
};

const SEVERITY_WORD = {
  success: 'Success',
  info: 'Information',
  warning: 'Warning',
  error: 'Error',
} as const;

export function Alert({
  severity,
  title,
  children,
}: {
  severity: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
}) {
  const c = SEV[severity];

  return (
    <div
      role="alert"
      className="aur-alert"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 16px',
        borderRadius: 'var(--radius-sm)',
        borderLeft: `3px solid ${c.main}`,
        fontFamily: 'var(--font-ui)',
        boxSizing: 'border-box',
        background: c.fill,
      }}
    >
      <span style={srOnly}>{SEVERITY_WORD[severity]}:</span>
      {c.icon ? (
        <Icon name={c.icon} size={20} color={c.main} style={{ flexShrink: 0, marginTop: 1 }} />
      ) : null}
      <div style={{ flex: 1, minWidth: 0, color: c.content }}>
        {title ? (
          <div style={{ fontWeight: 700, fontSize: '0.9375rem', marginBottom: children ? 2 : 0 }}>
            {title}
          </div>
        ) : null}
        {children ? (
          <div style={{ fontSize: '0.875rem', lineHeight: 1.5, opacity: 0.92 }}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}
