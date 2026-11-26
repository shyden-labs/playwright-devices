import { describe, expect, it } from 'vitest';
import type { WdaClock } from '../../src/devices/wda-client.ts';
import { MARKER_LABEL, screenPointsOf, type MarkerPage } from '../../src/devices/screen-marker.ts';
import { MARKER_CSS_SIZE, type Box } from '../../src/devices/screen-map.ts';

/** Where the page is scrolled, and where the marker's own client rect says it sits. */
interface FakeView {
  scrollX: number;
  scrollY: number;
  markerClient: { x: number; y: number };
}

const UNSCROLLED: FakeView = { scrollX: 0, scrollY: 0, markerClient: { x: 0, y: 0 } };

/** A page stand-in: runs each evaluated function against a tiny fake DOM and records what it did. */
function fakePage(log: string[], view: FakeView = UNSCROLLED): MarkerPage {
  const body = {
    children: [] as Record<string, unknown>[],
    append(el: Record<string, unknown>) {
      this.children.push(el);
      log.push(`drawn ${String(el.ariaLabel)} ${JSON.stringify(el.style)} role=${String(el.role)}`);
    },
  };
  const document = {
    body,
    createElement: () => {
      const el: Record<string, unknown> = {
        style: {},
        getBoundingClientRect: () => ({ ...view.markerClient, width: MARKER_CSS_SIZE, height: MARKER_CSS_SIZE }),
      };
      el.setAttribute = (name: string, value: string) => {
        el[name === 'aria-label' ? 'ariaLabel' : name] = value;
      };
      el.remove = () => {
        body.children.splice(body.children.indexOf(el), 1);
        log.push(`removed ${String(el.ariaLabel)}`);
      };
      return el;
    },
    querySelectorAll: () => body.children,
  };
  return {
    evaluate: <R, A>(fn: (arg: A) => R, arg: A) => {
      const g = globalThis as Record<string, unknown>;
      const before = { document: g.document, window: g.window };
      g.document = document;
      g.window = { scrollX: view.scrollX, scrollY: view.scrollY };
      try {
        return Promise.resolve(fn(arg));
      } finally {
        g.document = before.document;
        g.window = before.window;
      }
    },
  };
}

const box: Box = { x: 16, y: 92, width: 96, height: 48 };

/** A clock that only moves when the code sleeps; past 5 s means a wait without its ceiling. */
function fakeClock(): WdaClock {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      if (t > 5_000) return Promise.reject(new Error('waited past 5000 ms: a wait has no ceiling'));
      return Promise.resolve();
    },
  };
}

describe('screenPointsOf', () => {
  it('draws the marker at the scroll position, reads it back through WebDriverAgent, removes it, and maps the box centre', async () => {
    const log: string[] = [];
    const reader = {
      rectOf: (label: string) => {
        log.push(`read ${label}`);
        return Promise.resolve({ x: 0, y: 68, width: 100, height: 100 });
      },
    };

    const point = await screenPointsOf(fakePage(log), reader)(box);

    expect(point).toEqual({ x: 64, y: 184 });
    expect(log).toEqual([
      `drawn ${MARKER_LABEL} ${JSON.stringify({
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: `${MARKER_CSS_SIZE}px`,
        height: `${MARKER_CSS_SIZE}px`,
        zIndex: '2147483647',
        pointerEvents: 'none',
        background: 'rgb(255, 0, 255)',
      })} role=img`,
      // Read twice: two agreeing reads mean the page has stopped moving.
      `read ${MARKER_LABEL}`,
      `read ${MARKER_LABEL}`,
      `removed ${MARKER_LABEL}`,
    ]);
  });

  it('taps where the page is after typing scrolled it: a fixed marker sat 49 px off on the iPhone Air', async () => {
    // Measured 2026-11-26 (research/devices/evidence/probe-type-then-file-*): with the keyboard up Safari
    // scrolled the page by 49 px and drew a fixed marker at screen y 19, so the tap landed on the line
    // above the file input. The marker drawn at the scroll position read back at screen y 68.
    const log: string[] = [];
    const reader = { rectOf: () => Promise.resolve({ x: 0, y: 68, width: 100, height: 100 }) };
    const view = { scrollX: 0, scrollY: 49, markerClient: { x: 0, y: 0 } };
    const fileInput: Box = { x: 69.59375, y: 301.59375, width: 266, height: 20 };

    expect(await screenPointsOf(fakePage(log, view), reader)(fileInput)).toEqual({ x: 202.59375, y: 379.59375 });
    expect(log[0]).toContain('"position":"absolute","left":"0px","top":"49px"');
  });

  it('maps by the client rect the marker reports, not by where it was asked to sit', async () => {
    const reader = { rectOf: () => Promise.resolve({ x: 0, y: 68, width: 100, height: 100 }) };
    const view = { scrollX: 30, scrollY: 200, markerClient: { x: -4, y: 12 } };

    expect(await screenPointsOf(fakePage([], view), reader)(box)).toEqual({ x: 68, y: 172 });
  });

  it('measures again on every call, so a Safari toolbar that moved after a scroll is followed', async () => {
    const log: string[] = [];
    const rects = [
      { x: 0, y: 68, width: 100, height: 100 },
      { x: 0, y: 68, width: 100, height: 100 },
      { x: 0, y: 20, width: 100, height: 100 },
      { x: 0, y: 20, width: 100, height: 100 },
    ];
    const reader = { rectOf: () => Promise.resolve(rects.shift() as Box) };
    const toScreen = screenPointsOf(fakePage(log), reader);

    expect(await toScreen(box)).toEqual({ x: 64, y: 184 });
    expect(await toScreen(box)).toEqual({ x: 64, y: 136 });
  });

  it('waits for the page to stop moving: a read taken while the keyboard moved it is not used', async () => {
    // Measured on the iPhone Air, 2026-11-20: right after typing, the marker read back 100 by 102.
    const rects = [
      { x: 0, y: 320, width: 100, height: 102 },
      { x: 0, y: 300, width: 100, height: 102 },
      { x: 0, y: 68, width: 100, height: 100 },
      { x: 0, y: 68, width: 100, height: 100 },
    ];
    const reader = { rectOf: () => Promise.resolve(rects.shift() as Box) };

    expect(await screenPointsOf(fakePage([]), reader, fakeClock())(box)).toEqual({ x: 64, y: 184 });
  });

  it('fails at 5 s when the marker never reads the same twice, naming the last two reads, and removes it', async () => {
    const log: string[] = [];
    let y = 0;
    const reader = { rectOf: () => Promise.resolve({ x: 0, y: (y += 1), width: 100, height: 100 }) };
    const clock = fakeClock();

    await expect(screenPointsOf(fakePage(log), reader, clock)(box)).rejects.toThrow(
      /^the marker did not settle within 5000 ms; last two reads: \{"x":0,"y":\d+,"width":100,"height":100\} then \{/,
    );
    expect(clock.now()).toBe(5_000);
    expect(log.at(-1)).toBe(`removed ${MARKER_LABEL}`);
  });

  it('removes the marker even when WebDriverAgent cannot find it, and passes the failure on', async () => {
    const log: string[] = [];
    const reader = { rectOf: () => Promise.reject(new Error('no element showed')) };

    await expect(screenPointsOf(fakePage(log), reader)(box)).rejects.toThrow('no element showed');
    expect(log.at(-1)).toBe(`removed ${MARKER_LABEL}`);
  });
});
