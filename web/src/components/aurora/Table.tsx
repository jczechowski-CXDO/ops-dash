import { useState, type ReactNode } from 'react';

// Ported from _ds_bundle.js lines 2014-2098. Dropped: stickyHeader,
// className/style/rest passthrough, and the `hover` opt-out (row hover is always
// on). Measurements are the bundle's and are load-bearing per the handoff.

/**
 * `key` is `keyof R & string`, never plain `string`. Defect G-4 was a column
 * keyed 'dur' against a row field named 'duration': the table indexed row['dur'],
 * rendered four empty cells, and neither tsc nor any test complained. With this
 * constraint that column does not compile.
 */
export type Column<R> = {
  key: keyof R & string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  /** Let this column give up width first, with an ellipsis, instead of pushing
   *  the table past its container. Exactly one column per table should set it —
   *  the one carrying free text. README § Tables promises the last column
   *  survives a ~1000px content well; without this, a long subject line pushed
   *  Email's REASON column past the card border and it was clipped mid-word. */
  truncate?: boolean;
  render?: (value: R[keyof R & string], row: R) => ReactNode;
};

export function Table<R extends Record<string, unknown>>({
  columns,
  rows,
  dense = false,
  getRowKey,
}: {
  columns: Column<R>[];
  rows: R[];
  dense?: boolean;
  getRowKey?: (row: R, i: number) => string;
}) {
  const padY = dense ? 8 : 14;

  return (
    <div
      className="aur-table"
      // width:100% + overflow:auto is what makes a narrow content well scroll the
      // table rather than clip its last column.
      style={{ width: '100%', overflow: 'auto', fontFamily: 'var(--font-ui)' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{
                  textAlign: c.align ?? 'left',
                  padding: `${padY}px 16px`,
                  background: 'var(--background-cardelevation1)',
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  borderBottom: '1px solid var(--divider)',
                  whiteSpace: 'nowrap',
                  ...(c.width ? { width: c.width } : {}),
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <Row key={getRowKey ? getRowKey(row, ri) : ri} row={row} columns={columns} padY={padY} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row<R extends Record<string, unknown>>({
  row,
  columns,
  padY,
}: {
  row: R;
  columns: Column<R>[];
  padY: number;
}) {
  const [hover, setHover] = useState(false);

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--action-hover, var(--grey-grey-50))' : 'transparent',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      {columns.map((c) => (
        <td
          key={c.key}
          style={{
            textAlign: c.align ?? 'left',
            padding: `${padY}px 16px`,
            color: 'var(--text-primary)',
            borderBottom: '1px solid var(--divider)',
            whiteSpace: 'nowrap',
            ...(c.truncate
              ? { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 }
              : {}),
          }}
        >
          {c.render ? c.render(row[c.key], row) : (row[c.key] as ReactNode)}
        </td>
      ))}
    </tr>
  );
}
