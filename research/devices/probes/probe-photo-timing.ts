// Probe (shyden-labs/playwright-devices#38): where the photo step's ~30 s goes on the CI simulators, and why
// the iPads' finger scroll after it goes unanswered. Times every WebDriverAgent call, keeps a screenshot and
// the screen's listing after Done and after the scroll, and makes the journey's own finger scroll
// with WebDriverAgent's wait for idle turned off (round 10).
import { writeFileSync } from 'node:fs';
import { webkit } from '@playwright/test';
import { iosSession } from '../device-session.ts';
import { connectWda } from '../wda-client.ts';
import { startJourneyServer } from '../serve.ts';
import { PHOTO_GRID_IMAGE } from '../ios-native.ts';
import { iosFingerScroll } from '../finger-scroll.ts';

const out = process.env.PROBE_OUT ?? 'research/devices/evidence/probe-photo-timing';
const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
const started = Date.now();
const lines: string[] = [];
const log = (s: string) => {
  const line = `${((Date.now() - started) / 1000).toFixed(2)}s ${s}`;
  console.log(line);
  lines.push(line);
};

/** Every WebDriverAgent call, its answer's status and how long it took. */
const timedFetch: typeof fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname.replace(/\/session\/[^/]+/, '/session/:id');
  const method = init?.method ?? 'GET';
  const t0 = Date.now();
  try {
    const response = await fetch(input, init);
    log(`  wda ${method} ${path} -> ${response.status} in ${Date.now() - t0} ms`);
    return response;
  } catch (e) {
    log(`  wda ${method} ${path} -> ${(e as Error).message} after ${Date.now() - t0} ms`);
    throw e;
  }
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  log(`step ${name}`);
  const t0 = Date.now();
  try {
    await run();
    log(`step ${name} done in ${Date.now() - t0} ms`);
  } catch (e) {
    log(`step ${name} FAILED after ${Date.now() - t0} ms: ${(e as Error).message}`);
  }
}

const server = await startJourneyServer(new URL('../journey.html', import.meta.url).pathname);
const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages())[0];
if (page === undefined) throw new Error('Safari has no tab open');
const wda = await connectWda({ url: wdaUrl, fetchFn: timedFetch });
// Taps go to the simulator through WebDriverAgent, as in the journey; a bare
// connectOverCDP page has no touch, so its locator.tap() refuses (round 8).
const session = iosSession({ page, wda, baseURL: server.baseURL, file: { folder: 'x', label: 'x' } });

async function keepScreen(stage: string): Promise<void> {
  await step(`screenshot ${stage}`, async () => {
    writeFileSync(`${out}-${stage}.png`, await wda.screenshot());
  });
  await step(`source ${stage}`, async () => {
    const response = await timedFetch(new URL('/source', wdaUrl), { signal: AbortSignal.timeout(30_000) });
    const xml = ((await response.json()) as { value: string }).value;
    writeFileSync(`${out}-${stage}.xml`, xml);
    log(`  /source is ${xml.length} chars`);
  });
}

try {
  await step('open the page', () => page.goto(new URL('/journey.html', server.baseURL).href));
  await step('tap Photo', () => session.page.getByLabel('Photo').tap());
  await step('tap Photo Library', () => wda.tapFirstShown(['Photo Library']));
  await step('tap the first photo', () => wda.tapTopLeftOf(PHOTO_GRID_IMAGE));
  await step('tap Done', () => wda.tapFirstShown(['Done']));
  await keepScreen('after-done');
  await step('wait for the grid to go', () => wda.waitGone(PHOTO_GRID_IMAGE));
  log(`photo-result: ${(await page.getByTestId('photo-result').textContent()) ?? '(none)'}`);
  // Round 9: after the iPad picker's Done, the photo reached the page and the scroll landed, but
  // WebDriverAgent held its answer ~30 s. Round 10: turning off its wait for idle (waitForIdleTimeout 0,
  // echoed back) changed nothing on the iPad mini (/actions still unanswered at 30 s). Round 11 times
  // a finger drag through WebDriverAgent's other touch path, /wda/dragfromtoforduration, before /actions.
  await step('finger drag through /wda/dragfromtoforduration', async () => {
    const status = (await (await timedFetch(new URL('/status', wdaUrl))).json()) as { sessionId?: string };
    if (status.sessionId === undefined) throw new Error('/status named no session');
    const size = (await (await timedFetch(new URL(`/session/${status.sessionId}/window/size`, wdaUrl))).json()) as {
      value: { width: number; height: number };
    };
    const { width, height } = size.value;
    await timedFetch(new URL(`/session/${status.sessionId}/wda/dragfromtoforduration`, wdaUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromX: width / 2, fromY: height * 0.6, toX: width / 2, toY: height * 0.3, duration: 0.4 }),
      signal: AbortSignal.timeout(40_000),
    });
  });
  log(`scroll-result after the drag: ${(await page.getByTestId('scroll-result').textContent()) ?? '(none)'}`);
  await step('finger scroll', () => iosFingerScroll(wda));
  log(`scroll-result: ${(await page.getByTestId('scroll-result').textContent()) ?? '(none)'}`);
  await keepScreen('after-scroll');
} finally {
  writeFileSync(`${out}.txt`, lines.join('\n') + '\n');
  await wda.close().catch((e: unknown) => {
    log(`close: ${(e as Error).message}`);
  });
  await browser.close();
  await server.close();
}
