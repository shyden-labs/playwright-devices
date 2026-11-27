/**
 * The unchanged journey (shyden-labs/playwright-devices#7): the same test on
 * every phone, tablet, simulator and emulator, every input real. One journey,
 * all its assertions, soft so one failure does not hide the rest.
 */
import { expect, test } from './journey-fixture.ts';

test('a page is read, tapped, typed into and scrolled by real input', async ({
  page,
  nativeChoose,
  nativeChooseFile,
  nativeChoosePhoto,
  fingerScroll,
}) => {
  await test.step('open the page', async () => {
    await page.goto('/journey.html');
    await expect(page.getByRole('heading', { name: 'Device journey' })).toBeVisible();
  });

  await test.step('tap', async () => {
    await page.getByRole('button', { name: 'Tap me' }).tap();
    await expect.soft(page.getByTestId('tap-result')).toHaveText('Tapped');
  });

  await test.step('type', async () => {
    await page.getByLabel('Name').tap();
    await page.keyboard.type('Ana');
    await expect.soft(page.getByTestId('typed-result')).toHaveText('Hello, Ana');
  });

  // shyden-labs/playwright-devices#67: the rest of Playwright's text, checkbox and key input, routed to the phone's own.
  await test.step('type into a field in one go', async () => {
    await page.getByLabel('Email').pressSequentially('ana@example.test');
    await expect.soft(page.getByTestId('email-result')).toHaveText('ana@example.test');
  });

  await test.step('tick and untick a box', async () => {
    await page.getByLabel('Agree').check();
    await expect.soft(page.getByTestId('agree-result')).toHaveText('Agreed');
    await expect.soft(page.getByLabel('Agree')).toBeChecked();
    await page.getByLabel('Agree').uncheck();
    await expect.soft(page.getByTestId('agree-result')).toHaveText('Not agreed');
  });

  await test.step('press Enter', async () => {
    await page.getByLabel('Search').tap();
    await page.keyboard.type('tea');
    await page.getByLabel('Search').press('Enter');
    await expect.soft(page.getByTestId('search-result')).toHaveText('Searched tea');
  });

  await test.step('choose a colour', async () => {
    await page.getByLabel('Colour').tap();
    await nativeChoose('Green');
    await expect.soft(page.getByTestId('colour-result')).toHaveText('Green');
  });

  await test.step('choose a file', async () => {
    await page.getByLabel('File').tap();
    await nativeChooseFile();
    await expect.soft(page.getByTestId('file-result')).toHaveText('device-journey.txt');
  });

  await test.step('choose a photo', async () => {
    await page.getByLabel('Photo').tap();
    await nativeChoosePhoto();
    await expect.soft(page.getByTestId('photo-result')).toHaveText(/^image\/.+/);
  });

  await test.step('finger scroll', async () => {
    await fingerScroll();
    await expect.soft(page.getByTestId('scroll-result')).toHaveText('Scrolled');
  });
});
