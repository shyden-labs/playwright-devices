import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { journeyResponse, lanAddress } from '../../research/devices/serve.ts';

describe('journeyResponse', () => {
  const html = '<!doctype html><title>Device journey</title>';

  it('serves the journey page as UTF-8 HTML that no cache keeps', () => {
    expect(journeyResponse('/journey.html', html)).toEqual({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body: html,
    });
  });

  it('ignores a query string', () => {
    expect(journeyResponse('/journey.html?run=2', html).status).toBe(200);
  });

  it.each(['/', '/journey.htm', '/../package.json', '/fixtures/device-journey.txt', '/favicon.ico'])(
    'answers 404 for anything else: %s',
    (path) => {
      expect(journeyResponse(path, html)).toEqual({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' });
    },
  );
});

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` };
}

describe('lanAddress', () => {
  it('answers the Wi-Fi (en0) IPv4 address, which the phones and simulators reach', () => {
    expect(lanAddress({ lo0: [v4('127.0.0.1', true)], utun3: [v4('100.64.0.2')], en0: [v4('10.179.17.81')] })).toBe('10.179.17.81');
  });

  it('fails naming what it saw when en0 has no IPv4 address', () => {
    expect(() => lanAddress({ lo0: [v4('127.0.0.1', true)] })).toThrow(
      'no IPv4 address on en0 (the Wi-Fi) to serve the journey to the phones; interfaces seen: lo0',
    );
  });
});
