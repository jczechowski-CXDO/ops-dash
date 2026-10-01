// Ported from _ds_bundle.js lines 3079-3182 (the LinearProgress half of
// Progress.jsx). Dropped: variant="indeterminate" and its inline <style>
// keyframes, CircularProgress, className/style/rest passthrough.
//
// Added per Task 4 Step 7: role="progressbar" with aria-valuenow/min/max. The
// bundle's bar is a bare <div> and is invisible to assistive technology.

export function LinearProgress({
  value,
  color = 'primary',
  thickness = 6,
}: {
  value: number;
  color?: 'primary' | 'success' | 'warning' | 'error';
  thickness?: number;
}) {
  // NaN is not ordered, so Math.min/Math.max alone would propagate it into an
  // aria attribute reading "NaN". Fold it to 0.
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

  return (
    <div
      className="aur-linear-progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        width: '100%',
        height: thickness,
        borderRadius: 999,
        background: 'var(--background-cardelevation3, var(--grey-grey-200))',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: `var(--${color}-main)`,
          borderRadius: 999,
          transition: 'width var(--dur-base) var(--ease-standard)',
        }}
      />
    </div>
  );
}
