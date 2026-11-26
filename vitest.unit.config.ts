import type { ViteUserConfig } from 'vitest/config';
import { UNIT_SETUP } from './tests/setup/files.ts';
import { failOnWarnings } from './tests/setup/warnings.ts';

// The unit suite: tests under tests/unit, 1 s per test and hook, no process or
// connection (tests/setup/unit-refusal.ts). `npm run test:coverage` runs the
// same suite with V8 coverage over the TypeScript under scripts/, src/ and research/devices/, held to one
// overall threshold (shyden-labs/repo-template#149). A type-only import: `defineConfig` only types the object.
export default {
  plugins: [failOnWarnings],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: UNIT_SETUP,
    testTimeout: 1_000,
    hookTimeout: 1_000,
    coverage: {
      provider: 'v8',
      include: ['scripts/**/*.ts', 'src/**/*.ts', 'research/devices/**/*.ts'],
      // Code that runs only against a phone, simulator or emulator, which the unit suite cannot reach
      // (shyden-labs/playwright-devices#44): the fixture that connects to a device, the journey spec
      // and the probes. Each module they call is unit-tested and counted. Sonar excludes the same list.
      exclude: ['research/devices/journey-fixture.ts', 'research/devices/journey.spec.ts', 'research/devices/probes/**'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
} satisfies ViteUserConfig;
