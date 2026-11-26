/**
 * Serves the journey page to the phones, simulators and emulators
 * (shyden-labs/playwright-devices#7). Only the one page is served: nothing
 * else in the repository is reachable from the network.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { lanAddress } from '../../src/devices/lan.ts';

export interface JourneyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The answer to a request for `path`: the journey page, or 404. */
export function journeyResponse(path: string, html: string): JourneyResponse {
  if (path.split('?')[0] === '/journey.html') {
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: html };
  }
  return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };
}

/** Starts serving `htmlPath` on the Wi-Fi address and a free port; answers the page's URL and how to stop. */
export async function startJourneyServer(htmlPath: string): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const html = await readFile(htmlPath, 'utf8');
  const host = lanAddress(networkInterfaces());
  const server = createServer((request, response) => {
    const { status, headers, body } = journeyResponse(request.url ?? '/', html);
    response.writeHead(status, headers).end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
