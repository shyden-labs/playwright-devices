/**
 * Measures, for shyden-labs/playwright-devices#7, each journey step on Mobile Safari over
 * webkit.connectOverCDP through ios_webkit_debug_proxy on port 9222, with a full URL (this route
 * ignores baseURL). Prints ok or FAILED per step. Output: evidence/ios-webkit-steps.txt.
 */
import './serve.ts';
import { webkit, expect } from '@playwright/test';
const b = await webkit.connectOverCDP('http://127.0.0.1:9222', { timeout: 20000 });
const page = b.contexts()[0]?.pages()[0];
if (page === undefined) throw new Error('the proxy listed no Safari tab');
async function step(name: string, f: () => Promise<unknown>): Promise<void> {
  const t = Date.now();
  try {
    const r = await f();
    console.log(`${name}: ok ${Date.now() - t}ms ${r === undefined ? '' : JSON.stringify(r)}`);
  } catch (e) {
    console.log(`${name}: FAILED ${Date.now() - t}ms ${String(e).split('\n')[0] ?? ''}`);
  }
}
await step('goto absolute', () => page.goto(`http://${process.env.PAGE_HOST ?? ''}:4517/journey.html`, { timeout: 15000 }));
await step('heading visible+text', async () => {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Device journey', { timeout: 5000 });
});
await step('viewport/touch', () =>
  page.evaluate(() => ({ w: innerWidth, h: innerHeight, touch: navigator.maxTouchPoints, ua: navigator.userAgent })),
);
await step('tap', () => page.getByRole('button', { name: 'Tap me' }).tap({ timeout: 5000 }));
await step('click', () => page.getByRole('button', { name: 'Tap me' }).click({ timeout: 5000 }));
await step('tap-result', () => expect(page.getByTestId('tap-result')).toHaveText('Tapped', { timeout: 3000 }));
await step('focus field by click', () => page.getByLabel('Name').click({ timeout: 5000 }));
await step('keyboard.type', () => page.keyboard.type('Ayu'));
await step('typed-result', () => expect(page.getByTestId('typed-result')).toHaveText('Ayu', { timeout: 3000 }));
await step('mouse.wheel', () => page.mouse.wheel(0, 600));
await step('scroll-result', () => expect(page.getByTestId('scroll-result')).toHaveText('Scrolled', { timeout: 3000 }));
await step('screenshot', async () => (await page.screenshot({ timeout: 10000 })).length);
process.exit(0);
