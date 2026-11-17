/** One journey, one route per run, chosen by DEVICE_ROUTE (shyden-labs/playwright-devices#7). */
import { defineConfig } from '@playwright/test';
import { serverPort } from './device-fixture.ts';

export default defineConfig({
  testDir: '.',
  testMatch: 'journey.spec.ts',
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `evidence/${process.env.DEVICE_ROUTE ?? 'unset'}.json` }]],
  use: { baseURL: `http://localhost:${String(serverPort)}`, trace: 'on' },
  outputDir: `evidence/${process.env.DEVICE_ROUTE ?? 'unset'}-output`,
  webServer: { command: 'node serve.ts', port: serverPort, reuseExistingServer: false },
});
