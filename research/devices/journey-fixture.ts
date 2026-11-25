/**
 * The journey's own page on the packaged phone fixture
 * (shyden-labs/playwright-devices#54): the research journey runs through
 * `src/devices/phones.ts`, exactly as a project would, with its one page
 * served on this Mac's LAN address.
 */
import { fileURLToPath } from 'node:url';
import { expect, test as phones } from '../../src/devices/phones.ts';
import { startJourneyServer } from './serve.ts';

export const test = phones.extend<object, { journeyURL: string }>({
  journeyURL: [
    // Playwright reads a fixture's dependencies from this pattern; the server needs none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startJourneyServer(fileURLToPath(new URL('./journey.html', import.meta.url)));
      try {
        await use(server.baseURL);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ journeyURL }, use) => {
    await use(journeyURL);
  },
});

export { expect };
