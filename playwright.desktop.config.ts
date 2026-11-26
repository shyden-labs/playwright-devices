import { defineConfig } from '@playwright/test';
import { desktopProjects } from './src/desktop/browsers.ts';

// The README's sample and the phones' journey, run by CI's desktop-e2e job on every desktop browser
// (shyden-labs/playwright-devices#17, #68: one spec on phones and desktop alike): no retries, and the JSON report and assertion counts the
// one-suite checks read (shyden-labs/playwright-devices#16).
export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/desktop/**/*.spec.ts', 'research/devices/journey.spec.ts'],
  forbidOnly: true,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/desktop-report.json' }],
    ['./src/one-suite/assertion-counter.ts', { outputFile: 'test-results/desktop-assertions.json', unnamedTarget: 'desktop' }],
  ],
  projects: desktopProjects(),
});
