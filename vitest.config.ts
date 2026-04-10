import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['verbose'],
    testTimeout: 15_000,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: [],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
    },
  },
})
