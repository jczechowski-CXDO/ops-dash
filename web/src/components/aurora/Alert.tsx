import type { ReactNode } from 'react';

// Ported from _ds_bundle.js lines 2563-2686 (variant="soft"). Dropped: the
// outlined and filled variants, severity="primary", onClose, action, custom
// icon, className/style/rest passthrough.
//
// The bundle's leading glyph is a Material Symbols ligature. That font is not
// vendored (no network at runtime) and the eleven extracted Aurora glyphs
// include no check_circle/info/warning/error, so the icon is dropped. Severity
// is carried instead by a 3px left accent in the severity's main token, which
// matches the alert-row treatment in README "Screens / views".

const SEV = {
  success: {
    fill: 'var(--alert-successfill, var(--success-lighter))',
    content: 'var(--alert-successcontent, var(--success-darker))',
    main: 'var(--success-main)',
  },
  info: {
    fill: 'var(--alert-infofill, var(--info-lighter))',
    content: 'var(--alert-infocontent, var(--info-darker))',
    main: 'var(--info-main)',
  },
  warning: {
    fill: 'var(--alert-warningfill, var(--warning-lighter))',
    content: 'var(--alert-warningcontent, var(--warning-darker))',
    main: 'var(--warning-main)',
  },
  error: {
    fill: 'var(--alert-errorfill, var(--error-lighter))',
    content: 'var(--alert-errorcontent, var(--error-darker))',
    main: 'var(--error-main)',
  },
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
