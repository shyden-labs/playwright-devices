import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WdaClock } from '../../research/devices/wda-client.ts';
import { androidPagePoint, androidScreenPointsOf, readViewport, type PageViewport } from '../../research/devices/android-page-map.ts';

/** Chrome's page area on the OnePlus CPH2653 (2026-11-20): its top is under the toolbar. */
const AREA = { x: 0, y: 160, width: 1440, height: 2854 };

/** The page as Chrome reported it there: density 560 / 160, no zoom, toolbar shown. */
const VIEWPORT: PageViewport = { devicePixelRatio: 3.5, offsetLeft: 0, offsetTop: 0, scale: 1, height: 758.29 };

describe('androidPagePoint', () => {
  it("answers a box's centre in the phone's pixels, the page starting where the visual viewport's height ends at the area's bottom", () => {
    const point = androidPagePoint({ x: 16, y: 100, width: 200, height: 40 }, VIEWPORT, AREA);
    // content top = 3014 - 758.29 * 3.5 = 360 (the toolbar's bottom edge)
    expect(point.x).toBeCloseTo(116 * 3.5, 6);
    expect(point.y).toBeCloseTo(360 + 120 * 3.5, 1);
  });

  it('follows the toolbar when it hides after a scroll: the viewport grows and the content starts higher', () => {
    const point = androidPagePoint({ x: 0, y: 0, width: 0, height: 0 }, { ...VIEWPORT, height: 815.43 }, AREA);
    expect(point.y).toBeCloseTo(3014 - 815.43 * 3.5, 6);
  });

  it("allows for pinch zoom, and takes the box as already relative to what shows: Chrome's boxes follow a pan", () => {
    const point = androidPagePoint(
      { x: 50, y: 60, width: 0, height: 0 },
      { devicePixelRatio: 2, offsetLeft: 10, offsetTop: 20, scale: 2, height: 400 },
      { x: 0, y: 200, width: 1600, height: 1800 },
    );
    expect(point).toEqual({ x: 50 * 2 * 2, y: 2000 - 400 * 2 * 2 + 60 * 2 * 2 });
  });

  it("aims at the part of a box above where Chrome's keyboard accessory covers the page", () => {
    // pixel_tablet emulator, run 45040015654: Colour ran 709.5 to 795.5 on the screen, the accessory view
    // covered from 752, and the box's centre (752.5) went to Chrome; the uncovered part's centre is 730.8.
    const point = androidPagePoint(
      { x: 16, y: 234.765625, width: 873.59375, height: 43 },
      { devicePixelRatio: 2, offsetLeft: 0, offsetTop: 116.5, scale: 1, height: 264 },
      { x: 0, y: 48, width: 2560, height: 720, coveredFrom: 752 },
    );
    expect(point.x).toBeCloseTo(905.59, 2);
    expect(point.y).toBeCloseTo((240 + 234.765625 * 2 + 752) / 2, 6);
  });

  it('aims at the centre when the covered part starts below the box', () => {
    const point = androidPagePoint(
      { x: 16, y: 100, width: 200, height: 40 },
      { devicePixelRatio: 2, offsetLeft: 0, offsetTop: 0, scale: 1, height: 264 },
      { x: 0, y: 48, width: 2560, height: 720, coveredFrom: 752 },
    );
    expect(point.y).toBeCloseTo(240 + 120 * 2, 6);
  });

  it('aims at Colour on the pixel_tablet emulator after a finger drag panned the page 176.5 px', () => {
    // Run 44993134413: the box read centre y 196.25 with offsetTop 176.5; subtracting the pan again aimed
    // at screen y 279.5 and the touch landed on the label at client y 197, 175 px above Colour.
    const point = androidPagePoint(
      { x: 16, y: 174.75, width: 873.59, height: 43 },
      { devicePixelRatio: 2, offsetLeft: 0, offsetTop: 176.5, scale: 1, height: 312 },
      { x: 0, y: 48, width: 2560, height: 816 },
    );
    expect(point.y).toBeCloseTo(240 + 196.25 * 2, 6);
  });
});

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

/** Answers each value in turn, the last one repeating. */
function inTurn<T>(values: T[]): () => Promise<T> {
  let i = 0;
  return () => Promise.resolve(values[Math.min(i++, values.length - 1)] as T);
}

describe('androidScreenPointsOf', () => {
  it('waits for the keyboard to finish resizing the page: a read mixing the old viewport and the new area is not used', async () => {
    // Measured 2026-11-20: right after typing, the page still said 759 while the dump already showed the shrunk area.
    // Reads: before the keyboard; the mix (old viewport, shrunk area); then settled, twice.
    const page = { evaluate: inTurn([VIEWPORT, VIEWPORT, { ...VIEWPORT, height: 437.43 }]) };
    const shrunk = { ...AREA, height: 1727 };
    const screen = { pageArea: inTurn([AREA, shrunk]) };

    const point = await androidScreenPointsOf(page, screen, fakeClock())({ x: 16, y: 355, width: 265.6, height: 44.3 });

    expect(point.y).toBeCloseTo(160 + 1727 - 437.43 * 3.5 + (355 + 22.15) * 3.5, 1);
  });

  it('notes the box, viewport and page area each aim used, so a failed tap shows what it was aimed from', async () => {
    // pixel_tablet emulator, run 45035234085: the Colour tap went to 906,753 and the page saw nothing; the
    // failure's dump came 60 s later, after the viewport changed, so the aim could not be rebuilt.
    const notes: string[] = [];
    const page = { evaluate: inTurn([VIEWPORT]) };
    const screen = { pageArea: inTurn([AREA]), note: (what: string) => notes.push(what) };

    await androidScreenPointsOf(page, screen, fakeClock())({ x: 16, y: 355, width: 265.6, height: 44.3 });

    expect(notes).toEqual([
      `aim at box ${JSON.stringify({ x: 16, y: 355, width: 265.6, height: 44.3 })} from viewport ${JSON.stringify(VIEWPORT)} and page area ${JSON.stringify(AREA)}`,
    ]);
  });

  it('fails at 5 s when the page never settles, naming the last two reads', async () => {
    let height = 400;
    const page = {
      evaluate: () => {
        height += 1;
        return Promise.resolve({ ...VIEWPORT, height });
      },
    };
    const clock = fakeClock();
    const toScreen = androidScreenPointsOf(page, { pageArea: inTurn([AREA]) }, clock);

    await expect(toScreen({ x: 0, y: 0, width: 0, height: 0 })).rejects.toThrow(
      /the page did not settle within 5000 ms; last two reads: \{/,
    );
    expect(clock.now()).toBe(5_000);
  });

  it('reads the page’s viewport and the page area afresh for every box', async () => {
    let reads = 0;
    const page = {
      evaluate: () => {
        reads += 1;
        return Promise.resolve(VIEWPORT);
      },
    };
    let looks = 0;
    const screen = {
      pageArea: () => {
        looks += 1;
        return Promise.resolve(AREA);
      },
    };
    const toScreen = androidScreenPointsOf(page, screen, fakeClock());

    await toScreen({ x: 0, y: 0, width: 0, height: 0 });
    const second = await toScreen({ x: 16, y: 100, width: 200, height: 40 });

    // Two agreeing reads per box: the layout is still.
    expect(reads).toBe(4);
    expect(looks).toBe(4);
    expect(second.y).toBeCloseTo(780, 1);
  });
});

describe('readViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the page's visual viewport and density", () => {
    vi.stubGlobal('window', {
      devicePixelRatio: 2.625,
      innerHeight: 790,
      visualViewport: { offsetLeft: 4, offsetTop: 92, scale: 1.5, height: 430.1 },
    });
    expect(readViewport()).toEqual({ devicePixelRatio: 2.625, offsetLeft: 4, offsetTop: 92, scale: 1.5, height: 430.1 });
  });

  it('falls back to the layout viewport, unscrolled and unzoomed, where the browser has no visual viewport', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3, innerHeight: 800, visualViewport: null });
    expect(readViewport()).toEqual({ devicePixelRatio: 3, offsetLeft: 0, offsetTop: 0, scale: 1, height: 800 });
  });
});
