import { describe, expect, it } from 'vitest';
import { androidFingerScroll, iosFingerScroll, parseWmSize, scrollSpan } from '../../src/devices/finger-scroll.ts';

describe('scrollSpan', () => {
  it('drags up the middle of the screen from 45% to 15% of its height (the measured Android span)', () => {
    expect(scrollSpan({ width: 1440, height: 3168 })).toEqual({ from: { x: 720, y: 1426 }, to: { x: 720, y: 475 } });
  });
});

describe('iosFingerScroll', () => {
  it('reads the screen size and sends one WebDriverAgent swipe over the span', async () => {
    const calls: string[] = [];
    const wda = {
      windowSize: () => Promise.resolve({ width: 420, height: 912 }),
      swipe: (from: object, to: object) => {
        calls.push(JSON.stringify({ from, to }));
        return Promise.resolve();
      },
    };

    await iosFingerScroll(wda);

    expect(calls).toEqual([JSON.stringify({ from: { x: 210, y: 410 }, to: { x: 210, y: 137 } })]);
  });
});

describe('parseWmSize', () => {
  it('reads the physical size', () => {
    expect(parseWmSize('Physical size: 1440x3168\n')).toEqual({ width: 1440, height: 3168 });
  });

  it('prefers the override size, which is what input coordinates use', () => {
    expect(parseWmSize('Physical size: 1440x3168\nOverride size: 1080x2376\n')).toEqual({ width: 1080, height: 2376 });
  });

  it('fails naming the output when no size is in it', () => {
    expect(() => parseWmSize('error: no devices')).toThrow('`adb shell wm size` printed no size: error: no devices');
  });
});

describe('androidFingerScroll', () => {
  it('asks adb for the screen size, then swipes the span over 400 ms', async () => {
    const runs: string[][] = [];
    const adb = (args: string[]) => {
      runs.push(args);
      return Promise.resolve(args.includes('wm') ? 'Physical size: 1440x3168\n' : '');
    };

    await androidFingerScroll(adb);

    expect(runs).toEqual([
      ['shell', 'wm', 'size'],
      ['shell', 'input', 'swipe', '720', '1426', '720', '475', '400'],
    ]);
  });
});
