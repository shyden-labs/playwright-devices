/**
 * Measures, for shyden-labs/playwright-devices#7, whether Playwright attaches to Safari on iOS
 * through ios_webkit_debug_proxy. Opens the journey page in Safari on the device named by
 * IOS_UDID, lists what the proxy at IWDP_PORT exposes, then tries chromium.connectOverCDP and
 * webkit.connectOverCDP on it. Prints each result; exits 0 once all are printed.
 */
import './serve.ts';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
import { serverPort } from './device-fixture.ts';

const udid = process.env.IOS_UDID ?? '';
const host = process.env.PAGE_HOST ?? '';
const iwdpPort = process.env.IWDP_PORT ?? '9222';
if (udid === '' || host === '') throw new Error('IOS_UDID and PAGE_HOST must be set');

const pageUrl = `http://${host}:${String(serverPort)}/journey.html`;
const openCommand =
  process.env.OPEN_WITH === 'simctl'
    ? ['xcrun', 'simctl', 'openurl', udid, pageUrl]
    : ['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', udid, '--payload-url', pageUrl, 'com.apple.mobilesafari'];
execFileSync(openCommand[0] ?? '', openCommand.slice(1), { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 4000));

const listing = await fetch(`http://127.0.0.1:${iwdpPort}/json`).then((r) => r.text());
console.log(`proxy /json: ${listing.replace(/\s+/g, ' ').slice(0, 600)}`);

async function measure(name: string, attempt: () => Promise<unknown>): Promise<void> {
  try {
    await attempt();
    console.log(`${name}: accepted`);
  } catch (error) {
    console.log(`${name}: refused: ${String(error).split('\n').slice(0, 3).join(' | ')}`);
  }
}

const pages = JSON.parse(listing) as { webSocketDebuggerUrl?: string }[];
const socket = pages.find((p) => p.webSocketDebuggerUrl !== undefined)?.webSocketDebuggerUrl ?? '';
const endpoints = [`http://127.0.0.1:${iwdpPort}`, socket.startsWith('ws') ? socket : `ws://${socket}`];
for (const endpoint of endpoints) {
  await measure(`chromium.connectOverCDP ${endpoint}`, () => chromium.connectOverCDP(endpoint, { timeout: 15000 }));
  await measure(`webkit.connectOverCDP ${endpoint}`, () => webkit.connectOverCDP(endpoint, { timeout: 15000 }));
}
process.exit(0);
