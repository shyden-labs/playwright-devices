/**
 * The address a phone reaches this Mac at (shyden-labs/playwright-devices#54):
 * the iPhone and the Android phone load the project's pages over the Wi-Fi,
 * so a project serves them on this address, not on localhost.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** The Mac's Wi-Fi (en0) IPv4 address. */
export function lanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string {
  const found = interfaces.en0?.find((info) => info.family === 'IPv4' && !info.internal);
  if (found === undefined) {
    const seen = Object.keys(interfaces).join(', ');
    throw new Error(
      `this Mac has no LAN IPv4 address on en0 (the Wi-Fi), so a phone cannot reach it: join the phone’s Wi-Fi; interfaces seen: ${seen}`,
    );
  }
  return found.address;
}

/** The base URL a phone opens a project's pages at: http on the Mac's LAN address and `port`. Set it as Playwright's `use.baseURL`. */
export function lanBaseURL(port: number, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`port must be a whole number from 1 to 65535: ${port}`);
  return `http://${lanAddress(interfaces)}:${port}`;
}
