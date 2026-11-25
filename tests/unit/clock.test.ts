import { afterEach, describe, expect, it, vi } from 'vitest';
import { realClock } from '../../src/devices/clock.ts';

describe('realClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the time from Date.now', () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    expect(realClock.now()).toBe(1_700_000_000_000);
  });

  it('sleeps for the given milliseconds, no less', async () => {
    vi.useFakeTimers();
    let woke = false;
    const sleeping = realClock.sleep(250).then(() => {
      woke = true;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(woke).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(woke).toBe(true);
  });
});
