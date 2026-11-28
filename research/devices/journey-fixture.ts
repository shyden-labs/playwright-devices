/**
 * The journey's own page on the packaged phone fixture
 * (shyden-labs/playwright-devices#54): the research journey runs through
 * `src/devices/phones.ts`, exactly as a project would, with its one page
 * served on this Mac's LAN address. A desktop browser runs the same journey
 * (shyden-labs/playwright-devices#68), its page served on loopback.
 */
import { fileURLToPath } from 'node:url';
import { PHONE_PROJECTS, test as phones } from '../../src/devices/phones.ts';
import { startJourneyServer } from './serve.ts';

export const test = phones.extend<object, { journeyURL: string }>({
  journeyURL: [
    // Playwright reads a fixture's dependencies from this pattern; the server needs none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const page = fileURLToPath(new URL('./journey.html', import.meta.url));
      const onPhone = (PHONE_PROJECTS as readonly string[]).includes(workerInfo.project.name);
      const server = await (onPhone ? startJourneyServer(page) : startJourneyServer(page, '127.0.0.1'));
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

export { expect } from '../../src/devices/phones.ts';
