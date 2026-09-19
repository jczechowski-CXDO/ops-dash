const PAD = 2;

/**
 * Scales raw millisecond samples into the viewBox. Higher latency sits higher.
 *
 * The contract says `spark` is raw milliseconds and the view scales them. This
 * component therefore only ever accepts number[]; it will not take a
 * pre-rendered `points` string, which would be an unescaped value reaching an
 * SVG attribute.
 */
export function Sparkline({
  values,
  color,
  height,
  viewBoxHeight,
}: {
  values: number[];
  color: string;
  height: number;
  viewBoxHeight: number;
}) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = viewBoxHeight - PAD * 2;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;

  const points = values
    .map((v, i) => {
      const norm = span === 0 ? 0.5 : (v - min) / span;
      const y = viewBoxHeight - PAD - norm * usable;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 100 ${viewBoxHeight}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
