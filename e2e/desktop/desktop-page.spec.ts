import { expect, test } from '@playwright/test';

// One journey on every desktop browser of the shared setup (shyden-labs/playwright-devices#17):
// a real desktop browser with a fine pointer and no touch, driven by real clicks and key presses,
// at each width in turn, set and reloaded inside this one test.
const PAGE = `<!doctype html>
<meta name="viewport" content="width=device-width">
<label>Name <input id="name"></label>
<button id="greet" type="button">Greet</button>
<p id="out"></p>
<script>
  document.getElementById('greet').addEventListener('click', () => {
    document.getElementById('out').textContent = 'Hello ' + document.getElementById('name').value;
  });
</script>`;

const WIDTHS = [1280, 1920];

test('a desktop browser takes real clicks and typing at each width', async ({ page }) => {
  for (const width of WIDTHS) {
    await test.step(`at ${String(width)} px`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(PAGE);
      expect.soft(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect.soft(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
      expect.soft(await page.evaluate(() => navigator.maxTouchPoints)).toBe(0);
      await page.getByLabel('Name').click();
      await page.keyboard.type('Shyden Labs');
      await page.getByRole('button', { name: 'Greet' }).click();
      await expect.soft(page.locator('#out')).toBeVisible();
      await expect.soft(page.locator('#out')).toHaveText('Hello Shyden Labs');
    });
  }
});
