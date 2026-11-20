import { describe, expect, it } from 'vitest';
import { androidPagePoint, androidScreenPointsOf, type PageViewport } from '../../research/devices/android-page-map.ts';

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

  it('allows for pinch zoom and the visual viewport’s offset', () => {
    const point = androidPagePoint(
      { x: 50, y: 60, width: 0, height: 0 },
      { devicePixelRatio: 2, offsetLeft: 10, offsetTop: 20, scale: 2, height: 400 },
      { x: 0, y: 200, width: 1600, height: 1800 },
    );
    expect(point).toEqual({ x: (50 - 10) * 2 * 2, y: 2000 - 400 * 2 * 2 + (60 - 20) * 2 * 2 });
  });
});

describe('androidScreenPointsOf', () => {
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
    const toScreen = androidScreenPointsOf(page, screen);

    await toScreen({ x: 0, y: 0, width: 0, height: 0 });
    const second = await toScreen({ x: 16, y: 100, width: 200, height: 40 });

    expect(reads).toBe(2);
    expect(looks).toBe(2);
    expect(second.y).toBeCloseTo(780, 1);
  });
});
