/**
 * Serves the journey page to the phones, simulators and emulators
 * (shyden-labs/playwright-devices#7). Only the one page is served: nothing
 * else in the repository is reachable from the network.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

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

/** The Mac's Wi-Fi IPv4 address: the iPhone reaches the Mac over Wi-Fi, and simulators and emulators share it. */
export function lanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string {
  const found = interfaces.en0?.find((info) => info.family === 'IPv4' && !info.internal);
  if (found === undefined) {
    const seen = Object.keys(interfaces).join(', ');
    throw new Error(`no IPv4 address on en0 (the Wi-Fi) to serve the journey to the phones; interfaces seen: ${seen}`);
  }
  return found.address;
}

/**
 * Where the journey server listens, and the host the device puts in the page's URL: the Wi-Fi
 * address for both by default; with `JOURNEY_HOST_ALIAS` (an Android emulator's 10.0.2.2, its alias
 * for the host's loopback, on a CI runner with no Wi-Fi), loopback and that alias
 * (shyden-labs/playwright-devices#38).
 */
export function journeyHosts(env: NodeJS.ProcessEnv, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): { listen: string; url: string } {
  const alias = env.JOURNEY_HOST_ALIAS;
  if (alias !== undefined && alias !== '') return { listen: '127.0.0.1', url: alias };
  const lan = lanAddress(interfaces);
  return { listen: lan, url: lan };
}

/** Starts serving `htmlPath` where `journeyHosts` says, on a free port; answers the page's URL and how to stop. */
export async function startJourneyServer(htmlPath: string): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const html = await readFile(htmlPath, 'utf8');
  const { listen, url } = journeyHosts(process.env, networkInterfaces());
  const server = createServer((request, response) => {
    const { status, headers, body } = journeyResponse(request.url ?? '/', html);
    response.writeHead(status, headers).end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, listen, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://${url}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
