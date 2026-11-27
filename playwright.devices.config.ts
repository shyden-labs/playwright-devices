import { defineConfig } from '@playwright/test';
import { phoneProjects } from './src/devices/phone-projects.ts';

// The unchanged journey on phones, tablets, simulators and emulators
// (shyden-labs/playwright-devices#7). One device at a time, no retries: a
// failure is found and fixed, never re-run away. The phone projects come from
// the package (shyden-labs/playwright-devices#54); run-journey.zsh picks one
// with --project and starts the device side first.
export default defineConfig({
  testDir: './research/devices',
  // DEVICE_SPEC runs a probe spec on the same fixture instead (research/devices/run-journey.zsh).
  testMatch: process.env.DEVICE_SPEC ?? 'journey.spec.ts',
  projects: phoneProjects(),
  workers: 1,
  retries: 0,
  // The slowest native picker took 26 s to open on the simulator; three pickers and their ceilings fit.
  timeout: 5 * 60_000,
  // A loaded simulator took about 14 s to show a chosen file (evidence 2026-11-19, and the iPad run of
  // 2026-11-20 18:15, whose photo showed after the 5 s default had passed): about twice that.
  expect: { timeout: 30_000 },
  // The run script copies the report into research/devices/evidence/ once a run is kept: a listing or a
  // probe must never overwrite kept evidence.
  reporter: [['list'], ['json', { outputFile: `test-results/devices/${process.env.JOURNEY_REPORT ?? 'unknown'}.json` }]],
});
