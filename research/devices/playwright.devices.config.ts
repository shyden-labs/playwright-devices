/** One journey, one route per run, chosen by DEVICE_ROUTE (shyden-labs/playwright-devices#7). */
import { defineConfig } from '@playwright/test';
import { serverPort } from './device-fixture.ts';

export default defineConfig({
  testDir: '.',
  testMatch: 'journey.spec.ts',
  retries: 0,
  // The journey with its three native pickers takes about 24 s on the iPhone (measured 2026-11-18),
  // too close to Playwright's default 30 s. On a freshly booted simulator one picker alone took up to
  // 26 s to open (measured 2026-11-19), and each native wait may run to its 60 s ceiling (wda-input.ts),
  // so the test is given room for its three pickers plus a picker closed after a failure.
  timeout: 300_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `evidence/${process.env.DEVICE_ROUTE ?? 'unset'}.json` }]],
  use: { baseURL: `http://localhost:${String(serverPort)}`, trace: 'on' },
  outputDir: `evidence/${process.env.DEVICE_ROUTE ?? 'unset'}-output`,
  webServer: { command: 'node serve.ts', port: serverPort, reuseExistingServer: false },
});
