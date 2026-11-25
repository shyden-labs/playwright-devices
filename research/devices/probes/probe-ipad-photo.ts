// Probe (shyden-labs/playwright-devices#7): what the iPad photo picker shows after a photo is tapped, and after Done.
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { webkit } from '@playwright/test';
import { iosSession } from '../../../src/devices/device-session.ts';
import { connectWda } from '../../../src/devices/wda-client.ts';
import { startJourneyServer } from '../serve.ts';
import { PHOTO_GRID_IMAGE } from '../../../src/devices/ios-native.ts';

// Kept with the evidence, never in a shared temporary folder.
const out = process.env.PROBE_OUT ?? fileURLToPath(new URL('../evidence/probe.txt', import.meta.url));
const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
const lines: string[] = [];
const log = (s: string) => {
  console.log(s);
  lines.push(s);
};
async function buttons(stage: string) {
  const xml = (await (await fetch(new URL('/source', wdaUrl))).json()) as { value: string };
  const found = xml.value
    .split('\n')
    .filter((l) => /XCUIElementType(Button|NavigationBar|Sheet|Other) .*(name|label)=/.test(l) && /visible="true"/.test(l))
    .filter((l) => /Button|NavigationBar|Sheet/.test(l))
    .map((l) => l.trim().replace(/ (enabled|accessible|index|value)="[^"]*"/g, ''));
  log(`--- ${stage}: ${found.length} visible buttons/bars ---`);
  for (const l of found) log(l);
}

const server = await startJourneyServer(new URL('../journey.html', import.meta.url).pathname);
const browser = await webkit.connectOverCDP(process.env.IWDP_URL ?? 'http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages())[0];
if (page === undefined) throw new Error('Safari has no tab open');
const wda = await connectWda({ url: wdaUrl });
const session = iosSession({ page, wda, baseURL: server.baseURL, file: { folder: 'x', label: 'x' } });
try {
  await session.page.goto('/journey.html');
  await session.page.getByLabel('Photo').tap();
  await wda.tapFirstShown(['Photo Library']);
  await buttons('photo library open');
  await wda.tapTopLeftOf(PHOTO_GRID_IMAGE);
  await new Promise((r) => setTimeout(r, 2000));
  await buttons('after tapping the first photo');
  const tapped = await wda.tapFirstShown(['Done']);
  await new Promise((r) => setTimeout(r, 3000));
  await buttons(`after tapping ${tapped}`);
  log(`photo-result: ${(await page.getByTestId('photo-result').textContent()) ?? '(none)'}`);
  writeFileSync(`${out}.png`, await wda.screenshot());
} finally {
  writeFileSync(out, lines.join('\n') + '\n');
  await session.close().catch((e: unknown) => {
    log(`close: ${(e as Error).message}`);
  });
  await browser.close();
  await server.close();
}
