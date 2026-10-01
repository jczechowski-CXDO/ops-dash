import { describe, it, expect, vi } from 'vitest';
import { createShutdown, type Stoppable } from './main.js';

describe('shutdown', () => {
  it('stops timers, then HTTP, then the store', async () => {
    // Order, not merely "all three were called". Closing the database while a
    // poll is writing is how a WAL gets a torn tail, and a test that only
    // counted calls would pass on every wrong ordering.
    const order: string[] = [];
    const app: Stoppable = {
      schedule: { stop: () => void order.push('timers') },
      api: { close: async () => void order.push('http') },
      store: { close: () => void order.push('store') },
    };
    const exit = vi.fn();
    createShutdown(app, () => {}, exit)('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(order).toEqual(['timers', 'http', 'store']);
  });

  it('is idempotent — a second signal does nothing', async () => {
    // Two Ctrl-Cs in quick succession. Without the guard the store closes
    // twice and the second throws on an already-closed handle, turning a clean
    // exit into a stack trace nobody reads and everybody worries about.
    let storeCloses = 0;
    const app: Stoppable = {
      schedule: { stop: () => {} },
      api: { close: async () => {} },
      store: { close: () => { storeCloses += 1; } },
    };
    const exit = vi.fn();
    const shutdown = createShutdown(app, () => {}, exit);
    shutdown('SIGINT');
    shutdown('SIGINT');
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(storeCloses).toBe(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('closes the store even when HTTP close rejects', async () => {
    // A hung or failing connection must not leave the database open. This is
    // why the store close is in `finally` and not after a successful `then`.
    let closed = false;
    const app: Stoppable = {
      schedule: { stop: () => {} },
      api: { close: async () => { throw new Error('a client would not let go'); } },
      store: { close: () => { closed = true; } },
    };
    const lines: string[] = [];
    const exit = vi.fn();
    createShutdown(app, (l) => void lines.push(l), exit)('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(closed).toBe(true);
    // And it says so rather than exiting silently on a failure.
    expect(lines.some((l) => l.includes('http close failed'))).toBe(true);
  });

  it('names the signal it received', async () => {
    const lines: string[] = [];
    const exit = vi.fn();
    createShutdown(
      { schedule: { stop: () => {} }, api: { close: async () => {} }, store: { close: () => {} } },
      (l) => void lines.push(l),
      exit,
    )('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(lines[0]).toBe('SIGTERM — stopping');
    expect(lines.at(-1)).toBe('stopped cleanly');
  });
});
