/**
 * The one journey measured on every device for shyden-labs/playwright-devices#7: an unchanged
 * Playwright test (goto, visible text, a real tap, real typing, an option chosen in the phone's own
 * native list, a real finger scroll). The target
 * is chosen outside the test, by `DEVICE_ROUTE`, so the test body never names a device.
 */
import { expect } from '@playwright/test';
import { test } from './device-fixture.ts';

test('a page is read, tapped, typed into and scrolled by real input', async ({ page, fingerScroll, nativeChoose }) => {
  await page.goto('/journey.html');
  await expect.soft(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.soft(page.getByRole('heading', { level: 1 })).toHaveText('Device journey');

  await page.getByRole('button', { name: 'Tap me' }).tap();
  await expect.soft(page.getByTestId('tap-result')).toHaveText('Tapped');

  await page.getByLabel('Name').tap();
  await page.keyboard.type('Ayu');
  await expect.soft(page.getByTestId('typed-result')).toHaveText('Ayu');

  // AC 4: the <select> opens the phone's own list, outside the page; the option is touched there.
  await page.getByLabel('Colour').tap();
  await nativeChoose('Green');
  await expect.soft(page.getByTestId('select-result')).toHaveText('Green');

  await fingerScroll();
  await expect.soft(page.getByTestId('scroll-result')).toHaveText('Scrolled');
});
