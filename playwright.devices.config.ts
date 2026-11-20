import { defineConfig } from '@playwright/test';

// The unchanged journey on phones, tablets, simulators and emulators
// (shyden-labs/playwright-devices#7). One device at a time, no retries: a
// failure is found and fixed, never re-run away. The run scripts set
// DEVICE_ROUTE and start the device side first.
export default defineConfig({
  testDir: './research/devices',
  testMatch: 'journey.spec.ts',
  workers: 1,
  retries: 0,
  // The slowest native picker took 26 s to open on the simulator; three pickers and their ceilings fit.
  timeout: 5 * 60_000,
  // The run script copies the report into research/devices/evidence/ once a run is kept: a listing or a
  // probe must never overwrite kept evidence.
  reporter: [['list'], ['json', { outputFile: `test-results/devices/${process.env.DEVICE_ROUTE ?? 'unknown'}.json` }]],
});
