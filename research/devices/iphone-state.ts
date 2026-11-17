/**
 * Stops an iPhone run at once, naming why, when the phone cannot be driven, instead of letting
 * devicectl hang (shyden-labs/playwright-devices#27). Measured 2026-11-18: after the iPhone
 * updated itself overnight to iOS 27.2.1 it listed as `connected (no DDI)`, and
 * `devicectl device info processes` gave no output for over 3 minutes
 * (evidence/iphone-no-ddi-list-2026-11-18.txt).
 *
 *   node research/devices/iphone-state.ts <udid>   exits 1 naming the problem, 0 when ready
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A healthy `devicectl list devices` took 0.5 s on 2026-11-18; a Safari launch answers within a
 * few seconds. 30 s leaves room for a slow USB tunnel while still failing a hang quickly. */
export const DEVICECTL_CEILING_MS = 30_000;

type Run = (file: string, args: string[], options: { encoding: 'utf8'; timeout: number }) => string;

/** Runs `xcrun devicectl <args>` with the stated ceiling; at the ceiling it fails naming the command. */
export function devicectl(args: string[], run: Run = execFileSync): string {
  try {
    return run('xcrun', ['devicectl', ...args], { encoding: 'utf8', timeout: DEVICECTL_CEILING_MS });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ETIMEDOUT') {
      throw new Error(
        `xcrun devicectl ${args.join(' ')} gave no answer within ${String(DEVICECTL_CEILING_MS / 1000)} s; check that the iPhone is unlocked and has its developer disk image (devicectl list devices)`,
        { cause: error },
      );
    }
    throw error;
  }
}

interface ListedDevice {
  hardwareProperties?: { udid?: string };
  connectionProperties?: { pairingState?: string; tunnelState?: string };
  deviceProperties?: { ddiServicesAvailable?: boolean };
}

/** Reads `devicectl list devices --json-output` and names what stops the iPhone being driven, if anything. */
export function iphoneProblem(list: unknown, udid: string): string | undefined {
  const devices = (list as { result?: { devices?: unknown } }).result?.devices;
  if (!Array.isArray(devices)) return 'devicectl list devices wrote no result.devices list; cannot read the iPhone state';
  const device = (devices as ListedDevice[]).find((d) => d.hardwareProperties?.udid === udid);
  if (device === undefined) return `devicectl does not list the iPhone ${udid}: plug it in and unlock it, then run again`;
  const pairing = device.connectionProperties?.pairingState;
  if (pairing !== 'paired') {
    return `the iPhone ${udid} is not paired with this Mac (devicectl: pairingState ${String(pairing)}): unlock it and tap Trust, then run again`;
  }
  const tunnel = device.connectionProperties?.tunnelState;
  if (tunnel !== 'connected') {
    return `the iPhone ${udid} has no CoreDevice tunnel (devicectl: tunnelState ${String(tunnel)}): unlock the phone and check its cable, then run again`;
  }
  const ddi = device.deviceProperties?.ddiServicesAvailable;
  if (ddi !== true) {
    return `the iPhone ${udid} has no developer disk image mounted (devicectl: ddiServicesAvailable ${String(ddi)}), so devicectl calls hang: unlock the phone and open Xcode's Devices and Simulators window until it shows the phone ready, then run again`;
  }
  return undefined;
}

/** Lists the devices through devicectl (under its ceiling) and throws naming any problem. */
export function assertIphoneReady(udid: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'iphone-state-'));
  try {
    const file = join(dir, 'list.json');
    devicectl(['list', 'devices', '--json-output', file]);
    const problem = iphoneProblem(JSON.parse(readFileSync(file, 'utf8')), udid);
    if (problem !== undefined) throw new Error(problem);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.filename === process.argv[1]) {
  const udid = process.argv[2];
  if (udid === undefined) {
    console.error('usage: node research/devices/iphone-state.ts <udid>');
    process.exit(2);
  }
  try {
    assertIphoneReady(udid);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
