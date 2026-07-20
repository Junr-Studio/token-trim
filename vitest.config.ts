import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // The handler modules and frame.ts are single string-literal exports that
      // are assembled into the generated proxy and executed via the harness
      // (new Function), not as imported code - so v8 cannot instrument their
      // logic and line coverage of the raw strings is not meaningful. Their
      // behavior is locked instead by the characterization suite in
      // test/handlers/*.cases.test.ts. Exclude them from the coverage metric.
      exclude: ['src/handlers/**', 'src/frame.ts'],
      thresholds: {
        statements: 88,
        branches: 78,
        functions: 90,
        lines: 88,
      },
    },
  },
})
