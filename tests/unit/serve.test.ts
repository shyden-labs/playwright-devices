import { describe, expect, it } from 'vitest';
import { journeyResponse } from '../../research/devices/serve.ts';

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
