/**
 * The one real clock the device library waits with. Every wait takes a clock
 * argument defaulting to this, so unit tests pass a fake one.
 */
import type { WdaClock } from './wda-client.ts';

export const realClock: WdaClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
