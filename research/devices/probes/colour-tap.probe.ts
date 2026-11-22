// Probe (shyden-labs/playwright-devices#38): where the Colour tap lands right after typing. On the CI
// emulators and the iPhone Duo simulator the colour list never showed (round 7, 2026-11-21); the Duo's
// screen showed the Name field's edit menu instead. Keeps the device's screen with the keyboard up, just
// after the tap and three seconds later, and the page's geometry at each, in the report.
import { test } from '../device-fixture.ts';

test('the Colour tap after typing', async ({ page, session }, testInfo) => {
  const keep = async (stage: string): Promise<void> => {
    await testInfo.attach(`screen ${stage}`, { body: await session.screenshot(), contentType: 'image/png' });
    const geometry = await page.evaluate(() => ({
      inner: { width: window.innerWidth, height: window.innerHeight },
      visual:
        window.visualViewport === null
          ? null
          : { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop, scale: window.visualViewport.scale },
      scrollY: window.scrollY,
      focused: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? document.activeElement?.tagName,
    }));
    const colour = await page.getByLabel('Colour').boundingBox();
    const name = await page.getByLabel('Name').boundingBox();
    testInfo.annotations.push({ type: stage, description: JSON.stringify({ geometry, colour, name }) });
  };

  await page.goto('/journey.html');
  await page.getByLabel('Name').tap();
  await page.keyboard.type('Ana');
  await keep('1 keyboard up after typing');
  await page.getByLabel('Colour').tap();
  await keep('2 just after the Colour tap');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await keep('3 three seconds later');
});
