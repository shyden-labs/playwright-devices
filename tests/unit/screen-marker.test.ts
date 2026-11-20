import { describe, expect, it } from 'vitest';
import { MARKER_LABEL, screenPointsOf, type MarkerPage } from '../../research/devices/screen-marker.ts';
import { MARKER_CSS_SIZE, type Box } from '../../research/devices/screen-map.ts';

/** A page stand-in: runs each evaluated function against a tiny fake DOM and records what it did. */
function fakePage(log: string[]): MarkerPage {
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
      const before = g.document;
      g.document = document;
      try {
        return Promise.resolve(fn(arg));
      } finally {
        g.document = before;
      }
    },
  };
}

const box: Box = { x: 16, y: 92, width: 96, height: 48 };

describe('screenPointsOf', () => {
  it('draws the fixed marker, reads it back through WebDriverAgent, removes it, and maps the box centre', async () => {
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
        position: 'fixed',
        left: '0px',
        top: '0px',
        width: `${MARKER_CSS_SIZE}px`,
        height: `${MARKER_CSS_SIZE}px`,
        zIndex: '2147483647',
        pointerEvents: 'none',
        background: 'rgb(255, 0, 255)',
      })} role=img`,
      `read ${MARKER_LABEL}`,
      `removed ${MARKER_LABEL}`,
    ]);
  });

  it('measures again on every call, so a Safari toolbar that moved after a scroll is followed', async () => {
    const log: string[] = [];
    const rects = [
      { x: 0, y: 68, width: 100, height: 100 },
      { x: 0, y: 20, width: 100, height: 100 },
    ];
    const reader = { rectOf: () => Promise.resolve(rects.shift() as Box) };
    const toScreen = screenPointsOf(fakePage(log), reader);

    expect(await toScreen(box)).toEqual({ x: 64, y: 184 });
    expect(await toScreen(box)).toEqual({ x: 64, y: 136 });
  });

  it('removes the marker even when WebDriverAgent cannot find it, and passes the failure on', async () => {
    const log: string[] = [];
    const reader = { rectOf: () => Promise.reject(new Error('no element showed')) };

    await expect(screenPointsOf(fakePage(log), reader)(box)).rejects.toThrow('no element showed');
    expect(log.at(-1)).toBe(`removed ${MARKER_LABEL}`);
  });
});
