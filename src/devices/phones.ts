/**
 * `@shyden-labs/playwright-devices/phones` (shyden-labs/playwright-devices#54):
 * a project's own Playwright tests on the real iPhone and the real Android
 * phone, every tap and key the phone's own. Projects come from
 * `phoneProjects()`; the phone opens pages at `use.baseURL`, which
 * `lanBaseURL(port)` gives; `playwright-devices start` starts the device side.
 */
import { fileURLToPath } from 'node:url';
import { expect, test as base } from '@playwright/test';
import { withNamedSteps, type DeviceSession } from './device-session.ts';
import { connectPhone, type PhoneFiles } from './phone-connect.ts';
import { REAL_EFFECTS } from './phone-effects.ts';

export { expect };
export { lanBaseURL } from './lan.ts';
export { PHONE_PROJECTS, phoneGroup, phoneProjects } from './phone-projects.ts';
export type { PhoneFiles } from './phone-connect.ts';

const shipped = (name: string) => fileURLToPath(new URL(`./phone-files/${name}`, import.meta.url));

/** The files the pickers offer unless a project sets `phoneFiles` with `test.use`. */
export const DEFAULT_PHONE_FILES: PhoneFiles = { document: shipped('device-journey.txt'), photo: shipped('device-journey.png') };

export interface PhoneFixtures {
  /** The files the native pickers offer: absolute paths. On the iPhone, `nativeChoosePhoto` picks the Photo Library's first photo, so `photo` is used on Android only. */
  phoneFiles: PhoneFiles;
  session: DeviceSession;
  nativeChoose: DeviceSession['nativeChoose'];
  nativeChooseFile: DeviceSession['nativeChooseFile'];
  nativeChoosePhoto: DeviceSession['nativeChoosePhoto'];
  fingerScroll: DeviceSession['fingerScroll'];
}

export const test = base.extend<PhoneFixtures>({
  phoneFiles: [DEFAULT_PHONE_FILES, { option: true }],
  session: async ({ baseURL, phoneFiles }, use, testInfo) => {
    if (baseURL === undefined) throw new Error('set use.baseURL to lanBaseURL(<port>): the phone opens pages there');
    const connection = await connectPhone(testInfo.project.name, process.env, baseURL, phoneFiles, REAL_EFFECTS);
    const session = withNamedSteps(connection.session, (name, body) => base.step(name, body));
    try {
      await use(session);
      // The phone's own screen, before teardown closes anything: Playwright's screenshot shows only the page.
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('device screen at failure', { body: await session.screenshot(), contentType: 'image/png' });
      }
    } finally {
      try {
        await session.close();
      } finally {
        await connection.disconnect();
      }
    }
  },
  page: async ({ session }, use) => {
    await use(session.page);
  },
  nativeChoose: async ({ session }, use) => {
    await use(session.nativeChoose);
  },
  nativeChooseFile: async ({ session }, use) => {
    await use(session.nativeChooseFile);
  },
  nativeChoosePhoto: async ({ session }, use) => {
    await use(session.nativeChoosePhoto);
  },
  fingerScroll: async ({ session }, use) => {
    await use(session.fingerScroll);
  },
});
