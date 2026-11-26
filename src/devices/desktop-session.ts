/**
 * The desktop equivalents of the phone session (shyden-labs/playwright-devices#68). Stub: the tests come first.
 */
import type { Page } from '@playwright/test';
import type { DeviceSession } from './device-session.ts';
import type { PhoneFiles } from './phone-connect.ts';

export function desktopPage(page: Page): Page {
  throw new Error(`desktopPage: not built yet (given a ${typeof page})`);
}

export function desktopSession(options: { page: Page; files: PhoneFiles }): DeviceSession {
  throw new Error(`desktopSession: not built yet (given ${Object.keys(options).join(', ')})`);
}

export function focusedSelect(view?: {
  activeElement: unknown;
  isSelect: (element: unknown) => boolean;
}): { labels: string[]; selected: number } | null {
  throw new Error(`focusedSelect: not built yet (given a ${typeof view})`);
}
