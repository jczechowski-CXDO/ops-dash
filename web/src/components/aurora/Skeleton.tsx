// Ported from _ds_bundle.js lines 3202-3265. Dropped: animation="wave" (its
// rgba(255,255,255,.6) gradient is the only literal colour in the original) and
// className/style/rest passthrough. Variant names follow the published
// signature: 'rect'/'circle' rather than the bundle's 'rectangular'/'circular'.
//
// M-8: the Skeleton stays aria-hidden. It is decorative — the grey boxes carry
// no information — and "this panel is loading" is a property of the panel, not
// of its placeholder, so the live region belongs in Panel.tsx, which owns the
// loading state and announces it there. Marking the boxes themselves as a status
// region would make every skeleton in a panel announce independently.
//
// The bundle ships its @keyframes in an inline <style> child. That element's
// text is part of the subtree's textContent, and a loading placeholder must
// render no text at all, so the <style> is dropped. The animation property is
// kept verbatim: the keyframes belong in the global stylesheet, not in every
// skeleton instance. Until they are declared there the property is inert and
// the placeholder is static — see the report for Task 4.

const PULSE = 'aur-skel-pulse 1.5s var(--ease-standard) infinite';

export function Skeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
}: {
  variant?: 'text' | 'rect' | 'circle';
  width?: string | number;
  height?: string | number;
  lines?: number;
}) {
  const radius = variant === 'circle' ? '50%' : variant === 'text' ? 6 : 'var(--radius-sm)';
  const h = height ?? (variant === 'text' ? 12 : variant === 'circle' ? 40 : 96);
  const w = width ?? (variant === 'circle' ? h : '100%');

  const fill = {
    background: 'var(--background-cardelevation3, var(--grey-grey-200))',
    borderRadius: radius,
    animation: PULSE,
  } as const;

  if (variant === 'text' && lines > 1) {
    return (
      <span
        className="aur-skeleton"
        aria-hidden="true"
        style={{ display: 'flex', flexDirection: 'column', gap: 8, width: w }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            style={{ ...fill, height: h, width: i === lines - 1 ? '70%' : '100%', display: 'block' }}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      className="aur-skeleton"
      aria-hidden="true"
      style={{ display: 'block', width: w, height: h, ...fill }}
    />
  );
}
