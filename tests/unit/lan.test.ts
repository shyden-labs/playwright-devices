import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({ networkInterfaces: () => ({ en0: [v4('192.168.1.3')] }) }));

const { lanAddress, lanBaseURL } = await import('../../src/devices/lan.ts');

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` };
}

const NO_LAN = 'this Mac has no LAN IPv4 address on en0 (the Wi-Fi), so a phone cannot reach it: join the phone’s Wi-Fi';

describe('lanAddress', () => {
  it('answers the Wi-Fi (en0) IPv4 address, which the phones reach', () => {
    expect(lanAddress({ lo0: [v4('127.0.0.1', true)], utun3: [v4('100.64.0.2')], en0: [v4('10.179.17.81')] })).toBe('10.179.17.81');
  });

  it('fails saying the phone cannot reach this Mac, naming the interfaces seen, when en0 has no IPv4 address', () => {
    expect(() => lanAddress({ lo0: [v4('127.0.0.1', true)] })).toThrow(`${NO_LAN}; interfaces seen: lo0`);
  });
});

describe('lanBaseURL', () => {
  it('is http on the LAN address and the given port', () => {
    expect(lanBaseURL(4321, { en0: [v4('192.168.1.3')] })).toBe('http://192.168.1.3:4321');
  });

  it("reads this Mac's own interfaces by default", () => {
    expect(lanBaseURL(4173)).toBe('http://192.168.1.3:4173');
  });

  it('fails when the Mac has no LAN address', () => {
    expect(() => lanBaseURL(4321, { lo0: [v4('127.0.0.1', true)] })).toThrow(NO_LAN);
  });

  it.each([0, 65_536, 1.5, Number.NaN])('refuses a port outside 1-65535: %s', (port) => {
    expect(() => lanBaseURL(port, { en0: [v4('192.168.1.3')] })).toThrow(`port must be a whole number from 1 to 65535: ${port}`);
  });
});
