/**
 * Measures, for shyden-labs/playwright-devices#7, whether Apple's XCUITest (WebDriverAgent) gives
 * Mobile Safari real input while Playwright reads the page. Playwright attaches through
 * ios_webkit_debug_proxy on IWDP_PORT (Safari must have one tab open); WebDriverAgent listens on
 * WDA_PORT. Each step prints ok or FAILED. The journey page records a tap only when the click is
 * trusted (`event.isTrusted`), so a faked click cannot pass. Output: evidence/ios-wda-steps.txt.
 */
import './serve.ts';
import { expect, type Page, webkit } from '@playwright/test';
import { serverPort } from './device-fixture.ts';

const host = process.env.PAGE_HOST ?? '';
const iwdpPort = process.env.IWDP_PORT ?? '9222';
const wda = `http://127.0.0.1:${process.env.WDA_PORT ?? '8100'}`;
if (host === '') throw new Error('PAGE_HOST must be set to an address the phone can reach');

async function wdaCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${wda}${path}`, init);
  const json = (await response.json()) as { value: unknown };
  if (!response.ok) throw new Error(`WDA ${method} ${path} ${String(response.status)}: ${JSON.stringify(json.value).slice(0, 200)}`);
  return json.value;
}

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  try {
    const result = await run();
    console.log(`${name}: ok ${String(Date.now() - started)}ms ${result === undefined ? '' : JSON.stringify(result)}`);
  } catch (error) {
    console.log(`${name}: FAILED ${String(Date.now() - started)}ms ${String(error).split('\n')[0] ?? ''}`);
  }
}

const browser = await webkit.connectOverCDP(`http://127.0.0.1:${iwdpPort}`, { timeout: 20000 });
const firstTab = browser.contexts()[0]?.pages()[0];
if (firstTab === undefined) throw new Error('the proxy listed no Safari tab');
const page: Page = firstTab;
const { sessionId } = (await wdaCall('POST', '/session', { capabilities: { alwaysMatch: {} } })) as { sessionId: string };
const s = `/session/${sessionId}`;

async function elementId(using: string, value: string): Promise<string> {
  const found = (await wdaCall('POST', `${s}/element`, { using, value })) as Record<string, string>;
  const id = Object.values(found)[0];
  if (id === undefined) throw new Error(`WDA found no element ${using}=${value}`);
  return id;
}

await step('goto', async () => {
  await page.goto(`http://${host}:${String(serverPort)}/journey.html`, { timeout: 15000 }).catch(() => undefined);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Device journey', { timeout: 10000 });
});
await step('WDA tap "Tap me"', async () => {
  const id = await elementId('accessibility id', 'Tap me');
  const wdaRect = await wdaCall('GET', `${s}/element/${id}/rect`);
  const cssBox = await page.getByRole('button', { name: 'Tap me' }).boundingBox();
  await wdaCall('POST', `${s}/element/${id}/click`);
  return { wdaRect, cssBox };
});
await step('tap-result (trusted click)', () => expect(page.getByTestId('tap-result')).toHaveText('Tapped', { timeout: 5000 }));
// Screen points for a page box. Safari's web view fills the screen and the page starts under its
// toolbar (measured 2026-11-17: 68 points on the iPhone Air), which page JavaScript cannot see. So
// a 100x100 CSS-pixel marker is fixed at the viewport's top-left for one moment, WebDriverAgent
// reads where it is on screen, and the marker is removed.
async function toScreen(box: { x: number; y: number; width: number; height: number }): Promise<{ x: number; y: number }> {
  const label = `pw-calibrate-${String(Date.now())}`;
  await page.evaluate((name) => {
    const marker = document.createElement('div');
    marker.id = name;
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', name);
    marker.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;z-index:2147483647;pointer-events:none';
    document.body.append(marker);
  }, label);
  try {
    const rect = (await wdaCall('GET', `${s}/element/${await elementId('accessibility id', label)}/rect`)) as {
      x: number;
      y: number;
      width: number;
    };
    const scale = rect.width / 100;
    return { x: Math.round(rect.x + (box.x + box.width / 2) * scale), y: Math.round(rect.y + (box.y + box.height / 2) * scale) };
  } finally {
    await page.evaluate((name) => document.getElementById(name)?.remove(), label);
  }
}

async function fingerPath(points: { x: number; y: number }[], moveMs: number): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) throw new Error('no points');
  const actions = [
    { type: 'pointerMove', duration: 0, x: first.x, y: first.y },
    { type: 'pointerDown', button: 0 },
    ...rest.map((point) => ({ type: 'pointerMove', duration: moveMs, x: point.x, y: point.y })),
    { type: 'pointerUp', button: 0 },
  ];
  await wdaCall('POST', `${s}/actions`, { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions }] });
}

await step('calibrated point vs WDA rect of Tap me', async () => {
  const box = await page.getByRole('button', { name: 'Tap me' }).boundingBox();
  if (box === null) throw new Error('no box');
  return await toScreen(box);
});
await step('finger tap Name field (screen point) and type', async () => {
  const box = await page.getByLabel('Name').boundingBox();
  if (box === null) throw new Error('no box');
  const point = await toScreen(box);
  await fingerPath([point], 0);
  await wdaCall('POST', `${s}/wda/keys`, { value: ['A', 'y', 'u'] });
  return point;
});
await step('typed-result', () => expect(page.getByTestId('typed-result')).toHaveText('Ayu', { timeout: 5000 }));
// The keyboard can scroll the page by itself, so close it, reset, and show the result is empty.
await step('scroll reset before swipe', async () => {
  const box = await page.getByRole('heading', { level: 1 }).boundingBox();
  if (box === null) throw new Error('no box');
  await fingerPath([await toScreen(box)], 0);
  await page.evaluate(() => {
    scrollTo(0, 0);
    const result = document.querySelector('[data-testid="scroll-result"]');
    if (result !== null) result.textContent = '';
  });
  return await page.evaluate(() => scrollY);
});
await step('finger swipe up', async () => {
  const size = (await wdaCall('GET', `${s}/window/size`)) as { width: number; height: number };
  const x = Math.round(size.width / 2);
  await fingerPath(
    [
      { x, y: Math.round(size.height * 0.45) },
      { x, y: Math.round(size.height * 0.15) },
    ],
    300,
  );
  return { size, scrollY: await page.evaluate(() => scrollY) };
});
await step('scroll-result', () => expect(page.getByTestId('scroll-result')).toHaveText('Scrolled', { timeout: 5000 }));
await wdaCall('DELETE', s).catch(() => undefined);
process.exit(0);
