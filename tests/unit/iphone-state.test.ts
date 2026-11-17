import { describe, expect, it, vi } from 'vitest';
import { DEVICECTL_CEILING_MS, devicectl, iphoneProblem } from '../../research/devices/iphone-state.ts';

const UDID = '00008150-000954D90A20401C';

/** The fields `xcrun devicectl list devices --json-output` wrote for the iPhone on 2026-11-18,
 * after its overnight update to iOS 27.2.1 (research/devices/evidence/iphone-no-ddi-list-2026-11-18.txt). */
function listWith(device: { pairingState?: string; tunnelState?: string; ddiServicesAvailable?: boolean }, udid = UDID): unknown {
  return {
    result: {
      devices: [
        {
          hardwareProperties: { udid },
          connectionProperties: { pairingState: device.pairingState ?? 'paired', tunnelState: device.tunnelState ?? 'connected' },
          deviceProperties: { ddiServicesAvailable: device.ddiServicesAvailable ?? true },
        },
      ],
    },
  };
}

describe('iphoneProblem', () => {
  it('finds nothing wrong with a paired, connected iPhone whose disk image is mounted', () => {
    expect(iphoneProblem(listWith({}), UDID)).toBeUndefined();
  });

  it('names the missing developer disk image, as measured after an iOS update, and what to do', () => {
    expect(iphoneProblem(listWith({ ddiServicesAvailable: false }), UDID)).toBe(
      `the iPhone ${UDID} has no developer disk image mounted (devicectl: ddiServicesAvailable false), so devicectl calls hang: unlock the phone and open Xcode's Devices and Simulators window until it shows the phone ready, then run again`,
    );
  });

  it('names a tunnel that is not connected', () => {
    expect(iphoneProblem(listWith({ tunnelState: 'disconnected' }), UDID)).toBe(
      `the iPhone ${UDID} has no CoreDevice tunnel (devicectl: tunnelState disconnected): unlock the phone and check its cable, then run again`,
    );
  });

  it('names a phone that is not paired', () => {
    expect(iphoneProblem(listWith({ pairingState: 'unpaired' }), UDID)).toBe(
      `the iPhone ${UDID} is not paired with this Mac (devicectl: pairingState unpaired): unlock it and tap Trust, then run again`,
    );
  });

  it('names a phone devicectl does not list', () => {
    expect(iphoneProblem(listWith({}, 'another'), UDID)).toBe(
      `devicectl does not list the iPhone ${UDID}: plug it in and unlock it, then run again`,
    );
  });

  it('refuses output that is not devicectl JSON, naming it', () => {
    expect(iphoneProblem({}, UDID)).toBe('devicectl list devices wrote no result.devices list; cannot read the iPhone state');
  });
});

describe('devicectl', () => {
  it('runs xcrun devicectl with the stated ceiling and returns its output', () => {
    const run = vi.fn(() => 'ok');
    expect(devicectl(['list', 'devices'], run)).toBe('ok');
    expect(run).toHaveBeenCalledWith('xcrun', ['devicectl', 'list', 'devices'], { encoding: 'utf8', timeout: DEVICECTL_CEILING_MS });
  });

  it('fails at the ceiling naming the command and the ceiling', () => {
    const run = vi.fn(() => {
      throw Object.assign(new Error('spawnSync xcrun ETIMEDOUT'), { code: 'ETIMEDOUT' });
    });
    expect(() => devicectl(['device', 'info', 'processes'], run)).toThrow(
      `xcrun devicectl device info processes gave no answer within ${String(DEVICECTL_CEILING_MS / 1000)} s; check that the iPhone is unlocked and has its developer disk image (devicectl list devices)`,
    );
  });

  it('passes any other failure on unchanged', () => {
    const failure = new Error('exit 1');
    const run = vi.fn(() => {
      throw failure;
    });
    expect(() => devicectl(['list', 'devices'], run)).toThrow(failure);
  });
});
