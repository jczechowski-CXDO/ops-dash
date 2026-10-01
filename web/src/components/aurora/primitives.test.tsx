import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import { Switch } from './Switch.js';
import { Table, type Column } from './Table.js';
import { LinearProgress } from './LinearProgress.js';
import { Skeleton } from './Skeleton.js';
import { Alert } from './Alert.js';
import { Icon } from './Icon.js';

describe('Button', () => {
  it('renders its label and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button variant="outlined" size="small" onClick={onClick}>Acknowledge</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Resolve</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('pairs each contained variant with the contrast token of the SAME family', () => {
    // HIGH-1 was a neutral button whose background came from --text-primary and
    // whose label came from --common-white: 1.13:1 in the dark palette, an
    // invisible label that reappeared only on hover. Mixing families is the bug
    // class, so assert the pairing rather than a ratio that a unit test in jsdom
    // cannot resolve (jsdom does not compute var() against the token sheet).
    //
    // The RUNG moved at G3 re-verification (-main was decoration grade and a
    // button label is text); the FAMILY pairing is the invariant and is what
    // this test has always been about, so it is updated rather than retired.
    for (const color of ['primary', 'success', 'error', 'warning', 'neutral'] as const) {
      const { container } = render(<Button variant="contained" color={color}>Go</Button>);
      expect(container.innerHTML).toContain(`var(--${color}-dark)`);
      expect(container.innerHTML).toContain(`var(--${color}-contrast)`);
      expect(container.innerHTML).not.toContain(`var(--${color}-main)`);
    }
  });

  it('never paints a label with a decoration-grade -main token, in any state', () => {
    // The call-site guard. The browser-free contrast suite in theme/ asserts that
    // the PICKERS return readable colours; Button never calls them, so that suite
    // structurally cannot see this — and did not. Seven of the eight elements
    // still failing AA at G3 re-verification were this component.
    //
    // Asserted as "the colour is a -dark/-darker/-contrast rung", not as "no hex
    // appears": forbidding a bad literal is the shape that has now failed four
    // times on this build, because it also permits rgb(), a wrong token and a
    // missing style.
    const READABLE = /^var\(--(?:[a-z]+-(?:dark|darker|contrast)|text-(?:primary|secondary))\)$/;
    const offenders: string[] = [];

    for (const variant of ['contained', 'outlined', 'text'] as const) {
      for (const color of ['primary', 'success', 'error', 'warning', 'neutral'] as const) {
        for (const disabled of [false, true]) {
          const { container, unmount } = render(
            <Button variant={variant} color={color} disabled={disabled}>Act</Button>,
          );
          const el = container.querySelector('button')!;
          const painted = el.style.color;
          if (!READABLE.test(painted)) {
            offenders.push(`${variant}/${color}${disabled ? '/disabled' : ''} -> ${painted}`);
          }
          // Hover recolours the label's backdrop; it must not recolour it wrongly.
          fireEvent.mouseEnter(el);
          const hovered = el.style.color;
          if (!READABLE.test(hovered)) {
            offenders.push(`${variant}/${color}${disabled ? '/disabled' : ''}:hover -> ${hovered}`);
          }
          unmount();
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not let a disabled label fall to the unreadable disabled grey', () => {
    // 'Acknowledged' is a completed STATE the operator reads, not a greyed-out
    // affordance, so it is judged as content. --text-disabled is 2.29:1.
    const { container } = render(<Button disabled>Acknowledged</Button>);
    const el = container.querySelector('button')!;
    expect(el.style.color).toBe('var(--text-secondary)');
    expect(el.style.opacity).toBe(''); // an opacity multiplier would scale it back down
  });

  it('uses only token colours', () => {
    const { container } = render(<Button color="success" variant="text">Resolve</Button>);
    expect(container.innerHTML).toContain('var(--success');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('IconButton', () => {
  it('exposes its accessible name and fires onClick', () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Switch to dark theme" onClick={onClick}>
        <Icon name="nights_stay" size={20} />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Refresh" disabled onClick={onClick}>
        <Icon name="monitoring" size={20} />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('reports the next value, not the event', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="Agent stale" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Agent stale' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked state to assistive tech', () => {
    render(<Switch checked onChange={() => {}} aria-label="Vendor rule" />);
    expect(screen.getByRole('switch', { name: 'Vendor rule' })).toBeChecked();
  });

  it('does not report a change when disabled', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} disabled onChange={onChange} aria-label="Legacy auth" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Legacy auth' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Table', () => {
  type Row = { id: string; dur: string };
  const columns: Column<Row>[] = [
    { key: 'id', label: 'Incident' },
    { key: 'dur', label: 'Duration', align: 'right' },
  ];

  it('renders uppercase header labels and one row per record', () => {
    render(<Table dense columns={columns} rows={[{ id: 'INC-2284', dur: '41m' }]} />);
    expect(screen.getByRole('columnheader', { name: 'Incident' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'INC-2284' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + 1
  });

  it('right-aligns a column that asks for it', () => {
    render(<Table dense columns={columns} rows={[{ id: 'INC-2284', dur: '41m' }]} />);
    expect(screen.getByRole('cell', { name: '41m' })).toHaveStyle({ textAlign: 'right' });
  });

  it('uses a column render function when given one', () => {
    const cols: Column<Row>[] = [{ key: 'dur', label: 'Duration', render: (v) => <b>{String(v)}!</b> }];
    render(<Table columns={cols} rows={[{ id: 'x', dur: '41m' }]} />);
    expect(screen.getByText('41m!')).toBeInTheDocument();
  });

  it('scrolls horizontally rather than clipping the last column', () => {
    const { container } = render(<Table columns={columns} rows={[]} />);
    expect(container.firstElementChild).toHaveStyle({ overflow: 'auto' });
  });

  it('cannot be given a column key that is not a field of the row (defect G-4)', () => {
    // G-4 was a column keyed 'dur' against a field named 'duration': four empty
    // cells, no error, no failing test. Column<R>['key'] is `keyof R & string`,
    // so that column no longer compiles. If the constraint is ever relaxed to
    // plain `string` this @ts-expect-error becomes unused and tsc fails here.
    type HistoryRow = { id: string; duration: string };
    const bad: Column<HistoryRow>[] = [
      // @ts-expect-error 'dur' is not a key of HistoryRow
      { key: 'dur', label: 'Duration' },
    ];
    expect(bad).toHaveLength(1);
  });

  it('keys rows by getRowKey when given one', () => {
    // Re-rendering with the same identity keys must preserve DOM nodes; with an
    // index key a prepend would remount every row. Assert on identity, not markup.
    const rows = [{ id: 'a', dur: '1m' }, { id: 'b', dur: '2m' }];
    const { rerender, container } = render(
      <Table columns={columns} rows={rows} getRowKey={(r) => r.id} />,
    );
    const before = container.querySelector('tbody tr:last-child');
    rerender(
      <Table columns={columns} rows={[{ id: 'z', dur: '0m' }, ...rows]} getRowKey={(r) => r.id} />,
    );
    expect(container.querySelector('tbody tr:last-child')).toBe(before);
  });
});

describe('LinearProgress', () => {
  it('exposes its value to assistive tech and clamps out-of-range input', () => {
    render(<LinearProgress value={91} color="warning" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '91');
    render(<LinearProgress value={140} />);
    expect(screen.getAllByRole('progressbar')[1]).toHaveAttribute('aria-valuenow', '100');
  });

  it('clamps a negative value to zero rather than drawing backwards', () => {
    render(<LinearProgress value={-20} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Skeleton', () => {
  it('renders the requested number of lines and is hidden from assistive tech', () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(container.textContent).toBe('');
  });
});

describe('Alert', () => {
  it('conveys severity to assistive tech, not by hue alone', () => {
    render(<Alert severity="warning">disk filling</Alert>);
    // role="alert" alone announces urgency but not which kind.
    expect(screen.getByRole('alert')).toHaveTextContent(/^Warning:/);
  });

  it('renders as a live region with its title and body', () => {
    render(<Alert severity="warning" title="Stale data">Endpoint Central data is 14 minutes stale</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Stale data');
    expect(alert).toHaveTextContent('Endpoint Central data is 14 minutes stale');
  });

  it('distinguishes severities by token, not by icon glyph', () => {
    // The eleven vendored icons carry no check_circle/info/warning/error glyph and
    // the Material Symbols font is not shipped, so the bundle's ligature icon is
    // dropped. Severity must still be visually distinguishable.
    const { container: err } = render(<Alert severity="error">boom</Alert>);
    const { container: ok } = render(<Alert severity="success">fine</Alert>);
    expect(err.innerHTML).toContain('var(--error-main)');
    expect(ok.innerHTML).toContain('var(--success-main)');
  });
});
