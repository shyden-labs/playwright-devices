import { describe, expect, it } from 'vitest';
import type { WdaClock } from '../../research/devices/wda-client.ts';
import { MARKER_LABEL, screenPointsOf, type MarkerPage } from '../../research/devices/screen-marker.ts';
import { MARKER_CSS_SIZE, type Box } from '../../research/devices/screen-map.ts';

/** A page stand-in: runs each evaluated function against a tiny fake DOM and records what it did. */
function fakePage(log: string[], scroll: { scrollX: number; scrollY: number } = { scrollX: 0, scrollY: 0 }): MarkerPage {
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
      const el: Record<string, unknown> = { style: {} };
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
      g.window = scroll;
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
  it("draws the marker on the page at the box's top left, reads it back through WebDriverAgent, removes it, and maps the box centre", async () => {
    const log: string[] = [];
    const reader = {
      rectOf: (label: string) => {
        log.push(`read ${label}`);
        return Promise.resolve({ x: 16, y: 160, width: 100, height: 100 });
      },
    };

    const point = await screenPointsOf(fakePage(log), reader)(box);

    expect(point).toEqual({ x: 64, y: 184 });
    expect(log).toEqual([
      `drawn ${MARKER_LABEL} ${JSON.stringify({
        position: 'absolute',
        left: '16px',
        top: '92px',
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

  it('draws the marker where the box is in the document, so a page scrolled under the keyboard is followed', async () => {
    // iPhone Duo simulator, CI round 12 (run 44991089861): with the keyboard up the page was scrolled 92 px.
    // A fixed marker was read at screen y 0 whether drawn at top 0 or at the visual viewport's top (the
    // iPhone 18 Pro read 62 for both), so its reading ignored where it was drawn. WebDriverAgent listed the
    // Colour label 36 px above the drop-down's centre at y 242, putting that centre at screen y ~278.
    const log: string[] = [];
    const reader = { rectOf: () => Promise.resolve({ x: 16, y: 257.23, width: 100, height: 100 }) };
    const colour: Box = { x: 16, y: 257.23, width: 245, height: 42 };

    const point = await screenPointsOf(fakePage(log, { scrollX: 3, scrollY: 92 }), reader)(colour);

    expect(log[0]).toContain('"position":"absolute","left":"19px","top":"349.23px"');
    expect(point.x).toBeCloseTo(16 + 122.5, 5);
    expect(point.y).toBeCloseTo(257.23 + 21, 5);
  });

  it('measures again on every call, so a Safari toolbar that moved after a scroll is followed', async () => {
    const log: string[] = [];
    const rects = [
      { x: 16, y: 160, width: 100, height: 100 },
      { x: 16, y: 160, width: 100, height: 100 },
      { x: 16, y: 112, width: 100, height: 100 },
      { x: 16, y: 112, width: 100, height: 100 },
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
      { x: 16, y: 160, width: 100, height: 100 },
      { x: 16, y: 160, width: 100, height: 100 },
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
