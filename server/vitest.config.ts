import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Type-level assertions run here too, for the same reason they do in
    // `shared`: without typecheck mode a file of expectTypeOf calls reports a
    // green pass having proven nothing. See defect G-2 in docs/RESUME.md.
    typecheck: { enabled: true, include: ['src/**/*.test.ts'] },
  },
});
