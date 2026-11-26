/**
 * `@shyden-labs/playwright-devices/phones` (shyden-labs/playwright-devices#54):
 * a project's own Playwright tests on the real iPhone and the real Android
 * phone, every tap and key the phone's own. Projects come from
 * `phoneProjects()`; the phone opens pages at `use.baseURL`, which
 * `lanBaseURL(port)` gives; `playwright-devices start` starts the device side.
 */
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';
import { withNamedSteps, type DeviceSession } from './device-session.ts';
import { desktopPage, desktopSession } from './desktop-session.ts';
import { connectPhone, type PhoneFiles } from './phone-connect.ts';
import { REAL_EFFECTS } from './phone-effects.ts';
import { isPhoneProject } from './phone-projects.ts';

export { expect } from '@playwright/test';
export { lanBaseURL } from './lan.ts';
export { PHONE_PROJECTS, phoneGroup, phoneProjects } from './phone-projects.ts';
export type { PhoneFiles } from './phone-connect.ts';

const shipped = (name: string) => fileURLToPath(new URL(`./phone-files/${name}`, import.meta.url));

/** The files the pickers offer unless a project sets `phoneFiles` with `test.use`. */
export const DEFAULT_PHONE_FILES: PhoneFiles = { document: shipped('device-journey.txt'), photo: shipped('device-journey.png') };

export interface PhoneFixtures {
  /** The files the native pickers offer: absolute paths. On the iPhone, `nativeChoosePhoto` picks the Photo Library's first photo, so `photo` is used on Android only. */
  phoneFiles: PhoneFiles;
  /** The connected phone's session on a phone project; none on a desktop project, which connects nothing. */
  phoneConnection: DeviceSession | undefined;
  /** The phone's session, or on a desktop project the same steps as a person takes them at a desktop browser. */
  session: DeviceSession;
  nativeChoose: DeviceSession['nativeChoose'];
  nativeChooseFile: DeviceSession['nativeChooseFile'];
  nativeChoosePhoto: DeviceSession['nativeChoosePhoto'];
  fingerScroll: DeviceSession['fingerScroll'];
}

export const test = base.extend<PhoneFixtures>({
  phoneFiles: [DEFAULT_PHONE_FILES, { option: true }],
  phoneConnection: async ({ baseURL, phoneFiles }, use, testInfo) => {
    if (!isPhoneProject(testInfo.project.name)) {
      await use(undefined);
      return;
    }
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
  // One spec on the phones and every desktop browser (shyden-labs/playwright-devices#68): on a desktop project
  // the page is Playwright's own, whose input is already real there, with a tap made a click.
  page: async ({ page, phoneConnection }, use) => {
    await use(phoneConnection?.page ?? desktopPage(page));
  },
  session: async ({ phoneConnection, page, phoneFiles }, use) => {
    if (phoneConnection !== undefined) {
      await use(phoneConnection);
      return;
    }
    const session = desktopSession({ page, files: phoneFiles });
    try {
      await use(session);
    } finally {
      await session.close();
    }
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
