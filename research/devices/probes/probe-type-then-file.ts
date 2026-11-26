// Probe (shyden-labs/playwright-devices#54): on the iPhone, after typing into a field, does a tap on a file input
// reach the page? Logs the input's page box, the screen point tapped, every touch/click/focus event the page saw
// with its page coordinates, the focused element and the visual viewport, and keeps one device screenshot after
// each tap. Run 2026-11-26 14:13 (fixed marker): the first tap landed 48 px high, on the line above the input,
// while the keyboard had scrolled the page by 49 px. Run 14:15 (the marker drawn at the scroll position, as
// screen-marker.ts now does): the first tap hit the input and Safari's file menu opened.
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { webkit } from '@playwright/test';
import { iosSession } from '../../../src/devices/device-session.ts';
import { connectWda } from '../../../src/devices/wda-client.ts';
import { screenPointsOf } from '../../../src/devices/screen-marker.ts';
import { startJourneyServer } from '../serve.ts';

const evidence = fileURLToPath(new URL('../evidence/', import.meta.url));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const lines: string[] = [];
const log = (s: string) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${s}`;
  console.log(line);
  lines.push(line);
};

interface Seen {
  seen: string[];
}

/** Records every touch, click and focus event the page sees, with its page coordinates. */
function recordEvents(): void {
  const seen: string[] = [];
  (window as unknown as Seen).seen = seen;
  for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click', 'focusin', 'focusout']) {
    document.addEventListener(
      type,
      (e) => {
        const t = e.target as Element;
        const p = e instanceof MouseEvent ? ` at ${Math.round(e.clientX)},${Math.round(e.clientY)}` : '';
        const touch = e instanceof TouchEvent ? e.changedTouches[0] : undefined;
        const tp = touch === undefined ? '' : ` at ${Math.round(touch.clientX)},${Math.round(touch.clientY)}`;
        seen.push(`${type} on ${t.tagName}#${t.id}${p}${tp}`);
      },
      true,
    );
  }
}

/** The events since the last read, the focused element, the scroll and the visual viewport. */
function readState() {
  const active = document.activeElement;
  const vv = window.visualViewport;
  return {
    seen: (window as unknown as Seen).seen.splice(0),
    active: active === null ? 'none' : `${active.tagName}#${active.id}`,
    scrollY: window.scrollY,
    vv: vv === null ? 'none' : `${vv.offsetTop},${vv.height},${vv.scale}`,
  };
}

const server = await startJourneyServer(new URL('./clean-page.html', import.meta.url).pathname);
const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
const firstPage = browser.contexts().flatMap((c) => c.pages())[0];
if (firstPage === undefined) throw new Error('Safari has no tab open');
const page = firstPage;
const wda = await connectWda({ url: process.env.WDA_URL ?? 'http://127.0.0.1:8100' });
const session = iosSession({
  page,
  wda,
  baseURL: server.baseURL,
  file: { folder: 'WebDriverAgentRunner-Runner', label: 'device-journey' },
});
const toScreen = screenPointsOf(page, wda);

async function logState(what: string): Promise<void> {
  const s = await page.evaluate(readState);
  log(`${what}: active ${s.active}, scrollY ${s.scrollY}, visualViewport top,height,scale ${s.vv}`);
  for (const e of s.seen) log(`  event ${e}`);
}

/** One tap on the file input at the mapped point, then the page's state and the screen 3 s later. */
async function tapFile(round: number): Promise<void> {
  const box = await page.locator('#file').boundingBox();
  if (box === null) throw new Error('the file input has no box');
  const point = await toScreen(box);
  log(`tap ${round}: file input page box ${JSON.stringify(box)}, screen point ${JSON.stringify(point)}`);
  await wda.tapAt(point);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await logState(`3 s after tap ${round}`);
  writeFileSync(`${evidence}probe-type-then-file-${stamp}-tap${round}.png`, await wda.screenshot());
}

try {
  await session.page.goto('/journey.html', { timeout: 120_000 });
  await page.evaluate(recordEvents);
  await session.page.getByRole('button', { name: 'Press me' }).tap();
  await session.page.getByLabel('Name').tap();
  await session.page.keyboard.type('Ana');
  await logState('after typing');
  await tapFile(1);
  await tapFile(2);
} finally {
  writeFileSync(`${evidence}probe-type-then-file-${stamp}.txt`, `${lines.join('\n')}\n`);
  await session.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await server.close();
}
