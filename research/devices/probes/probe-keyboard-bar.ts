// Probe (shyden-labs/playwright-devices#77): on the Android phone, with the keyboard up after a real tap on Name,
// which package owns the bar between the page and the keys, where is it, and what does the page's visual viewport
// say at the same moment? Keeps the uiautomator dump, a device screenshot and the page's numbers as evidence.
// Run 2026-11-28 15:21 WIB on the OPPO CPH2653, Chrome 158: the bar is Chrome's own (keyboard_accessory, its
// contents from y 1335), drawn inside the page area (compositor_view_holder, to y 1503); the visual viewport ended
// at y 1338, so a map ending the page at the area's bottom aimed every tap about 168 px low.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startChromeCold } from '../../../src/devices/android-chrome-start.ts';
import { androidPagePoint, type PageViewport } from '../../../src/devices/android-page-map.ts';
import { rectOfResourceId } from '../../../src/devices/android-screen.ts';
import { PAGE_AREA_ID } from '../../../src/devices/android-native.ts';
import type { ScreenRect } from '../../../src/devices/wda-client.ts';
import { startJourneyServer } from '../serve.ts';

const serial = process.env.ANDROID_SERIAL ?? '';
const evidence = fileURLToPath(new URL('../evidence/', import.meta.url));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const lines: string[] = [];
const log = (s: string) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${s}`;
  console.log(line);
  lines.push(line);
};
const adb = (...args: string[]) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' });
const dump = () => adb('exec-out', 'uiautomator', 'dump', '/dev/tty');

function pageArea(screen: string): ScreenRect {
  const area = rectOfResourceId(screen, PAGE_AREA_ID);
  if (area === undefined) throw new Error(`the dump lists no ${PAGE_AREA_ID}`);
  return area;
}

/** Every node of Chrome's around its page and keyboard, and every node of another app's, with its bounds. */
function barNodes(screen: string): string[] {
  const found: string[] = [];
  for (const [node] of screen.matchAll(/<node [^>]*>/g)) {
    const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(node)?.[1] ?? '';
    const pkg = attribute('package');
    const id = attribute('resource-id');
    if (
      /accessory|bar_items|keyboard|compositor|control_container/i.test(id) ||
      (pkg !== 'com.android.chrome' && !pkg.includes('systemui'))
    ) {
      found.push(`${pkg} ${id} [${attribute('content-desc')}] ${attribute('bounds')}`);
    }
  }
  return found;
}

function readViewport(): PageViewport {
  const viewport = window.visualViewport;
  return {
    devicePixelRatio: window.devicePixelRatio,
    offsetLeft: viewport?.offsetLeft ?? 0,
    offsetTop: viewport?.offsetTop ?? 0,
    scale: viewport?.scale ?? 1,
    height: viewport?.height ?? window.innerHeight,
  };
}

const server = await startJourneyServer(fileURLToPath(new URL('../journey.html', import.meta.url)));
const chrome = await startChromeCold({ adb: (args) => Promise.resolve(adb(...args)), port: 9333 });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const [context] = browser.contexts();
if (context === undefined) throw new Error('Chrome lists no browser context');
const page = await context.newPage();
try {
  await page.goto(`${server.baseURL}/journey.html`);
  log(`chrome ${/versionName=(\S+)/.exec(adb('shell', 'dumpsys', 'package', 'com.android.chrome'))?.[1] ?? 'unknown'}`);
  log(`keyboard down: viewport ${JSON.stringify(await page.evaluate(readViewport))}`);
  // A real tap on Name, aimed the way the package aims it before the keyboard shows.
  const name = await page.locator('#name').boundingBox();
  if (name === null) throw new Error('Name has no box');
  const area = pageArea(dump());
  const point = androidPagePoint(name, await page.evaluate(readViewport), area);
  log(`page area ${JSON.stringify(area)}; tap Name at screen ${Math.round(point.x)},${Math.round(point.y)}`);
  adb('shell', 'input', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
  await page.waitForTimeout(2500);
  const screen = dump();
  const viewport = await page.evaluate(readViewport);
  log(`keyboard up: focused #${await page.evaluate(() => document.activeElement?.id ?? 'none')}`);
  log(`keyboard up: viewport ${JSON.stringify(viewport)}; page area ${JSON.stringify(pageArea(screen))}`);
  for (const id of ['#email', '#agree']) {
    const box = await page.locator(id).boundingBox();
    if (box !== null) log(`${id} box ${JSON.stringify(box)} maps to ${JSON.stringify(androidPagePoint(box, viewport, pageArea(screen)))}`);
  }
  for (const node of barNodes(screen)) log(`node ${node}`);
  writeFileSync(`${evidence}keyboard-bar-${stamp}.xml`, screen);
  writeFileSync(`${evidence}keyboard-bar-${stamp}.png`, execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p']));
  writeFileSync(`${evidence}keyboard-bar-${stamp}.txt`, `${lines.join('\n')}\n`);
  log(`kept evidence/keyboard-bar-${stamp}.*`);
} finally {
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await page.close();
  await browser.close();
  await chrome.stop();
  await server.close();
}
