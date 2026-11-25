import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * shyden-labs/playwright-devices#55: round 43 (run 45571245564) lost the iPhone Duo's WebDriverAgent log
 * for the hang it failed on, because the next launch (the colour-tap probe) wrote to the same wda.log.
 * Each launch of WebDriverAgent and of the Safari debug proxy writes a log of its own, so a CI round
 * uploads every one.
 */
const script = readFileSync('research/devices/run-journey.zsh', 'utf8');
const redirects = (log: string) =>
  [...script.matchAll(/\s>(\S+)\s+2>&1/g)].map((match) => match[1] ?? '').filter((target) => target.split('/').at(-1)?.startsWith(log));

describe('run-journey.zsh logs', () => {
  it('writes each WebDriverAgent launch to a log named for that launch', () => {
    const targets = redirects('wda');
    expect(targets).toEqual(['$logs/wda-$stamp-$$.log']);
  });

  it('writes each Safari debug proxy launch to a log named for that launch', () => {
    const targets = redirects('iwdp');
    expect(targets).toEqual(['$wda/logs/iwdp-$stamp-$$.log', '$wda/logs-sim/iwdp-$stamp-$$.log']);
  });
});
