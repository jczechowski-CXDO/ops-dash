import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // contracts.test.ts asserts with expectTypeOf. Those assertions are
    // TYPE-level: without typecheck mode Vitest runs the file, finds no runtime
    // expectations, and reports a green pass that proves nothing at all.
    typecheck: { enabled: true, include: ['src/**/*.test.ts'] },
  },
});
