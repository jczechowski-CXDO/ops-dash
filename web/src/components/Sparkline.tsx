const PAD = 2;

/**
 * Scales raw millisecond samples into the viewBox. Higher latency sits higher.
 *
 * The contract says `spark` is raw milliseconds and the view scales them. This
 * component therefore only ever accepts numbers; it will not take a
 * pre-rendered `points` string, which would be an unescaped value reaching an
 * SVG attribute.
 *
 * ## A `null` sample is a probe that did not answer
 *
 * The wire type is `Array<number | null>` and the reason is argued at length in
 * `server/src/api/tile.ts`: a hole is a probe that produced no measurement, and
 * both of the easy ways to get rid of it draw an outage as good news.
 *
 *   - **dropping** it shortens the series, so a service that answered twice out
 *     of twenty-eight draws the same two-point line as a service that was asked
 *     twice and answered both times
 *   - **zeroing** it dives the line to instantaneous, which is the best-looking
 *     thing on the page
 *
 * So a hole is drawn as a hole. Every sample keeps the x position its INDEX
 * gives it, which is what makes the history's length honest, and the stroke is
 * genuinely absent across the gap: one `<polyline>` per contiguous run of
 * answered samples rather than one for the series. A run of a single sample
 * repeats its point so a round line cap draws it as a dot — a lone answer
 * between two failures is a fact, and a one-point polyline renders nothing.
 *
 * Nulls take no part in the scaling, so a failed neighbour cannot move the
 * floor out from under the samples that did answer.
 *
 * How MANY holes there were is a sentence for the view to render beside the
 * chart. A primitive does not know what page it is on.
 */
export function Sparkline({
  values,
  color,
  height,
  viewBoxHeight,
}: {
  values: Array<number | null>;
  color: string;
  height: number;
  viewBoxHeight: number;
}) {
  const answered = values.filter((v): v is number => v !== null);
  // No samples at all and no sample that answered are different facts, and
  // both are the view's to phrase. Neither is a line.
  if (answered.length === 0) return null;

  const min = Math.min(...answered);
  const max = Math.max(...answered);
  const span = max - min;
  const usable = viewBoxHeight - PAD * 2;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;

  const at = (v: number, i: number) => {
    const norm = span === 0 ? 0.5 : (v - min) / span;
    const y = viewBoxHeight - PAD - norm * usable;
    return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
  };

  // Contiguous runs of answered samples, each carrying its own index so the
  // gap keeps its width.
  const runs: string[][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (runs[runs.length - 1]?.length) runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1]?.push(at(v, i));
  });

  return (
    <svg
      viewBox={`0 0 100 ${viewBoxHeight}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
      aria-hidden="true"
    >
      {runs
        .filter((run) => run.length > 0)
        .map((run) => (
          <polyline
            key={run[0]}
            // A single answered sample is drawn as a zero-length segment; the
            // round cap makes it a dot of the stroke's own width, which the
            // non-scaling stroke keeps circular under this viewBox's uneven
            // x/y scaling.
            points={(run.length === 1 ? [run[0], run[0]] : run).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            // Only on the dot: a round cap on a normal run would add half a
            // stroke width to each end of every line on the dashboard, and the
            // 152 visual baselines would all move for a change that is meant to
            // be additive.
            {...(run.length === 1 ? { strokeLinecap: 'round' as const } : {})}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </svg>
  );
}
