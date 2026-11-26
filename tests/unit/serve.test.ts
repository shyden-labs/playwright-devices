import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { journeyHosts, journeyResponse } from '../../research/devices/serve.ts';

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

describe('journeyHosts', () => {
  const wifi = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.9' } as NetworkInterfaceInfo] };

  it('listens on and serves from the Wi-Fi address by default', () => {
    expect(journeyHosts({}, wifi)).toEqual({ listen: '192.168.1.9', url: '192.168.1.9' });
  });

  it("serves an Android emulator through its alias for the host's loopback, listening on loopback only", () => {
    // The emulator reaches the host's 127.0.0.1 as 10.0.2.2; a CI runner has no en0 (shyden-labs/playwright-devices#38).
    expect(journeyHosts({ JOURNEY_HOST_ALIAS: '10.0.2.2' }, { lo: [], eth0: [] })).toEqual({ listen: '127.0.0.1', url: '10.0.2.2' });
  });
});
