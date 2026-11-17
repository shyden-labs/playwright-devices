/**
 * Measures, for shyden-labs/playwright-devices#18, why the android-cdp finger swipe sometimes does
 * not scroll the journey page. Repeats the journey's steps on the android-cdp route (cold Chrome,
 * new context and page over CDP, tap, tap Name, type) RUNS times, and per run prints what the
 * swipe met: the page's visibility and focus, whether the keyboard was shown, the viewport, the
 * swipe's start and end points, and scrollY before and over 1.5 s after. A run that did not scroll
 * also saves a screenshot of the phone taken just before its swipe.
 * Usage: ANDROID_SERIAL=<serial> RUNS=20 node android-swipe.device.ts
 */
import './serve.ts';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { serverPort } from './device-fixture.ts';

const serial = process.env.ANDROID_SERIAL ?? '';
if (serial === '') throw new Error('ANDROID_SERIAL must name the phone');
const runs = Number(process.env.RUNS ?? '20');
const cdpPort = 9222;
const adb = (...args: string[]): string => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' });
const adbBytes = (...args: string[]): Buffer => execFileSync('adb', ['-s', serial, ...args]);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const size = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size'));
const width = Number(size?.[1]);
const height = Number(size?.[2]);
const x = Math.round(width / 2);
const fromY = Math.round(height * 0.45);
const toY = Math.round(height * 0.15);
console.log(`screen ${String(width)}x${String(height)}; swipe x=${String(x)} y ${String(fromY)} -> ${String(toY)} over 400ms`);

adb('reverse', `tcp:${String(serverPort)}`, `tcp:${String(serverPort)}`);
let failures = 0;
for (let run = 1; run <= runs; run++) {
  adb('shell', 'am', 'force-stop', 'com.android.chrome');
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'about:blank', 'com.android.chrome');
  const deadline = Date.now() + 5000;
  while (!adb('shell', 'cat', '/proc/net/unix').includes('@chrome_devtools_remote')) {
    if (Date.now() > deadline) throw new Error('DevTools socket did not open within 5000ms');
    await sleep(100);
  }
  adb('forward', `tcp:${String(cdpPort)}`, 'localabstract:chrome_devtools_remote');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(cdpPort)}`);
  const context = await browser.newContext({ baseURL: `http://localhost:${String(serverPort)}`, hasTouch: true, viewport: null });
  const page = await context.newPage();
  await page.goto('/journey.html');
  await page.getByRole('button', { name: 'Tap me' }).tap();
  await page.getByLabel('Name').tap();
  await page.keyboard.type('Ayu');
  const keyboard = /mInputShown=(\w+)/.exec(adb('shell', 'dumpsys input_method | grep mInputShown'))?.[1] ?? 'unknown';
  const before = await page.evaluate(() => ({
    visibility: document.visibilityState,
    focus: document.hasFocus(),
    scrollY,
    innerHeight,
    dpr: devicePixelRatio,
    visualHeight: visualViewport?.height,
  }));
  const startCss = Math.round(fromY / before.dpr);
  const underStart = await page.evaluate(
    ([cx, cy]: [number, number]) => {
      const el = document.elementFromPoint(cx, cy);
      return el === null ? 'none' : `${el.tagName}${el.id === '' ? '' : `#${el.id}`}`;
    },
    [Math.round(x / before.dpr), startCss] as [number, number],
  );
  const shot = adbBytes('exec-out', 'screencap', '-p');
  const sentAt = Date.now();
  adb('shell', 'input', 'swipe', String(x), String(fromY), String(x), String(toY), '400');
  const returnedMs = Date.now() - sentAt;
  const samples: number[] = [];
  for (let i = 0; i < 15; i++) {
    samples.push(await page.evaluate(() => scrollY));
    await sleep(100);
  }
  const scrolled = samples.some((y) => y > before.scrollY);
  if (!scrolled) {
    failures++;
    writeFileSync(`evidence/android-swipe-run${String(run)}-before.png`, shot);
  }
  console.log(
    `run ${String(run)}: ${scrolled ? 'SCROLLED' : 'NOT SCROLLED'} visibility=${before.visibility} focus=${String(before.focus)} keyboard=${keyboard} ` +
      `innerHeight=${String(before.innerHeight)} visualHeight=${String(before.visualHeight)} dpr=${String(before.dpr)} startCssY=${String(startCss)} under=${underStart} ` +
      `scrollY before=${String(before.scrollY)} after=[${samples.join(',')}] swipeReturned=${String(returnedMs)}ms`,
  );
  await context.close();
  await browser.close();
  adb('forward', '--remove', `tcp:${String(cdpPort)}`);
}
adb('reverse', '--remove', `tcp:${String(serverPort)}`);
console.log(`${String(failures)} of ${String(runs)} runs did not scroll`);
process.exit(0);
