// Probe (shyden-labs/playwright-devices#67): on Android, after typing the email, where does the real tap on the
// Agree tick box land? Run 2026-11-27 04:21 (journey at 48085cd): the finger drag brought the box above the
// keyboard, but "check" failed with the box still unchecked and the step took 14.8 s. Logs the box, what shows,
// the screen point tapped and every touch the page saw, then tries the tap.
// Run: PROBE=research/devices/probes/probe-agree-tap.ts zsh research/devices/run-journey.zsh android <serial> <route>
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { connectPhone } from '../../../src/devices/phone-connect.ts';
import { REAL_EFFECTS } from '../../../src/devices/phone-effects.ts';
import { DEFAULT_PHONE_FILES } from '../../../src/devices/phones.ts';
import { readPlace } from '../../../src/devices/real-input-page.ts';
import { startJourneyServer } from '../serve.ts';

const route = process.env.DEVICE_ROUTE ?? 'android-cdp';
const evidence = fileURLToPath(new URL('../evidence/', import.meta.url));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const lines: string[] = [];
const log = (s: string) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${s}`;
  console.log(line);
  lines.push(line);
};

const server = await startJourneyServer(fileURLToPath(new URL('../journey.html', import.meta.url)));
const connection = await connectPhone(route, process.env, server.baseURL, DEFAULT_PHONE_FILES, REAL_EFFECTS);
const { page } = connection.session;
try {
  await page.goto('/journey.html');
  await page.getByLabel('Name').tap();
  await page.keyboard.type('Ana');
  await page.getByLabel('Email').pressSequentially('ana@example.test');
  const agree = page.getByLabel('Agree');
  log(`box before: ${JSON.stringify(await agree.boundingBox())}`);
  log(`place before: ${JSON.stringify(await agree.evaluate(readPlace))}`);
  await page.evaluate(() => {
    (window as unknown as { touchesSeen: string[] }).touchesSeen.length = 0;
  });
  await agree.tap();
  log(`box after: ${JSON.stringify(await agree.boundingBox())}`);
  log(`place after: ${JSON.stringify(await agree.evaluate(readPlace))}`);
  log(`checked after one tap: ${String(await agree.isChecked())}`);
  log(`devicePixelRatio: ${String(await page.evaluate(() => window.devicePixelRatio))}`);
  const seen = await page.evaluate(() => (window as unknown as { touchesSeen: string[] }).touchesSeen);
  for (const line of seen) log(`page saw: ${line}`);
  writeFileSync(`${evidence}probe-agree-tap-${route}-${stamp}.png`, await connection.session.screenshot());
} finally {
  writeFileSync(`${evidence}probe-agree-tap-${route}-${stamp}.txt`, `${lines.join('\n')}\n`);
  await connection.session.close();
  await connection.disconnect();
  await server.close();
}
