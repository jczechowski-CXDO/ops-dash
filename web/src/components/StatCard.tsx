import { LinearProgress } from './aurora/LinearProgress.js';
import { Card } from './Card.js';

/** README: 11px/600 --text-secondary label over a 21-24px/700 tabular-nums value. */
export function StatCard({
  label,
  value,
  note,
  valueColor = 'var(--text-primary)',
  valueSize = 22,
  progress,
  'data-testid': testId,
}: {
  label: string;
  value: string;
  note?: string;
  valueColor?: string;
  valueSize?: 21 | 22 | 24;
  progress?: { value: number; color: 'primary' | 'success' | 'warning' | 'error' };
  /** Forwarded to the Card root, so the hook is on the card and not a wrapper. */
  'data-testid'?: string;
}) {
  return (
    <Card
      padding="14px 16px"
      style={{ display: 'flex', flexDirection: 'column', gap: progress ? 6 : 3 }}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
          fontSize: valueSize,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
      </div>
      {progress ? <LinearProgress value={progress.value} color={progress.color} /> : null}
      {note ? <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{note}</div> : null}
    </Card>
  );
}
