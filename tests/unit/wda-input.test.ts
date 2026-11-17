import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { openWdaInput, wdaHttp, type WdaCall } from '../../research/devices/wda-input.ts';

interface Sent {
  method: string;
  path: string;
  body?: unknown;
}

/** A WebDriverAgent stand-in: the marker sits under a 68-point toolbar at scale 1, the screen is 420x912. */
function fakeWda(markerRect = { x: 0, y: 68, width: 100, height: 100 }): { call: WdaCall; sent: Sent[] } {
  const sent: Sent[] = [];
  const call: WdaCall = (method, path, body) => {
    sent.push({ method, path, body });
    if (path === '/session') return Promise.resolve({ sessionId: 'S' });
    if (path === '/session/S/element') return Promise.resolve({ 'element-6066-11e4-a52e-4f735466cecf': 'E' });
    if (path === '/session/S/element/E/rect') return Promise.resolve(markerRect);
    if (path === '/session/S/window/size') return Promise.resolve({ width: 420, height: 912 });
    return Promise.resolve(null);
  };
  return { call, sent };
}

function fakePage(): Page & { evaluate: ReturnType<typeof vi.fn> } {
  return { evaluate: vi.fn(() => Promise.resolve(undefined)) } as unknown as Page & { evaluate: ReturnType<typeof vi.fn> };
}

function touch(...actions: unknown[]): unknown {
  return { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openWdaInput', () => {
  it('opens a WebDriverAgent session and deletes it on close', async () => {
    const { call, sent } = fakeWda();
    const input = await openWdaInput(call, fakePage());
    await input.close();
    expect(sent[0]).toEqual({ method: 'POST', path: '/session', body: { capabilities: { alwaysMatch: {} } } });
    expect(sent.at(-1)).toEqual({ method: 'DELETE', path: '/session/S', body: undefined });
  });

  it('taps the centre of a page box at its screen point, under the toolbar', async () => {
    const { call, sent } = fakeWda();
    const input = await openWdaInput(call, fakePage());
    await input.tapAt({ x: 10, y: 20, width: 30, height: 40 });
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/session/S/actions',
      body: touch(
        { type: 'pointerMove', duration: 0, x: 25, y: 108 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ),
    });
  });

  it('scales the tap point by the marker width WebDriverAgent reads', async () => {
    const { call, sent } = fakeWda({ x: 0, y: 68, width: 50, height: 50 });
    const input = await openWdaInput(call, fakePage());
    await input.tapAt({ x: 10, y: 21, width: 30, height: 40 });
    const body = sent.at(-1)?.body as { actions: { actions: { x?: number; y?: number }[] }[] };
    expect(body.actions[0]?.actions[0]).toMatchObject({ x: 13, y: 89 });
  });

  it('finds the marker by its accessibility id, then removes it from the page', async () => {
    const { call, sent } = fakeWda();
    const page = fakePage();
    const input = await openWdaInput(call, page);
    await input.tapAt({ x: 10, y: 20, width: 30, height: 40 });
    const find = sent.find((s) => s.path === '/session/S/element');
    const label = page.evaluate.mock.calls[0]?.[1] as string;
    expect(label).toMatch(/^pw-calibrate-/);
    expect(find?.body).toEqual({ using: 'accessibility id', value: label });
    expect(page.evaluate.mock.calls).toHaveLength(2);
    expect(page.evaluate.mock.calls[1]?.[1]).toBe(label);
  });

  it('removes the marker even when WebDriverAgent cannot find it', async () => {
    const page = fakePage();
    const call: WdaCall = (_method, path) =>
      path === '/session' ? Promise.resolve({ sessionId: 'S' }) : Promise.reject(new Error('no such element'));
    const input = await openWdaInput(call, page);
    await expect(input.tapAt({ x: 1, y: 1, width: 1, height: 1 })).rejects.toThrow('no such element');
    expect(page.evaluate.mock.calls).toHaveLength(2);
  });

  it('types real keys, one character each', async () => {
    const { call, sent } = fakeWda();
    const input = await openWdaInput(call, fakePage());
    await input.type('Ayu');
    expect(sent.at(-1)).toEqual({ method: 'POST', path: '/session/S/wda/keys', body: { value: ['A', 'y', 'u'] } });
  });

  it('swipes a finger up from 45% to 15% of the screen height, in the middle', async () => {
    const { call, sent } = fakeWda();
    const input = await openWdaInput(call, fakePage());
    await input.swipeUp();
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/session/S/actions',
      body: touch(
        { type: 'pointerMove', duration: 0, x: 210, y: 410 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 400, x: 210, y: 137 },
        { type: 'pointerUp', button: 0 },
      ),
    });
  });
});

describe('tapNative', () => {
  const CELLS = {
    using: 'predicate string',
    value: 'type == "XCUIElementTypeCell" AND visible == 1 AND (label == "Green" OR label BEGINSWITH "Green, ")',
  };
  const PREDICATE = {
    using: 'predicate string',
    value: 'label == "Green" AND visible == 1 AND (type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText")',
  };
  const ELEMENT = (id: string) => ({ 'element-6066-11e4-a52e-4f735466cecf': id });

  /**
   * WebDriverAgent listing `matches` buttons or texts (and `cells` cells), but only from the
   * `appearsOn`-th lookup of buttons and texts.
   */
  function nativeWda(appearsOn = 1, matches = 1, cells = 0) {
    const sent: Sent[] = [];
    let lookups = 0;
    const call: WdaCall = (method, path, body) => {
      sent.push({ method, path, body });
      if (path === '/session') return Promise.resolve({ sessionId: 'S' });
      if (path === '/session/S/elements' && (body as { value: string }).value.startsWith('type == "XCUIElementTypeCell"')) {
        return Promise.resolve(Array.from({ length: cells }, (_, i) => ELEMENT(`C${String(i)}`)));
      }
      if (path === '/session/S/elements') {
        lookups += 1;
        return Promise.resolve(lookups < appearsOn ? [] : Array.from({ length: matches }, (_, i) => ELEMENT(`N${String(i)}`)));
      }
      if (path === '/session/S/element/N0/rect') return Promise.resolve({ x: 8, y: 347.7, width: 250, height: 35.7 });
      if (path === '/session/S/element/C0/rect') return Promise.resolve({ x: 282, y: 200, width: 128, height: 175.3 });
      return Promise.resolve(null);
    };
    return { call, sent, lookups: () => lookups };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the one visible native button or text with the label and taps the centre of its screen rect', async () => {
    const { call, sent } = nativeWda();
    const input = await openWdaInput(call, fakePage());
    await input.tapNative('Green');
    const lookups = sent.filter((s) => s.path === '/session/S/elements').map((s) => s.body);
    expect(lookups).toEqual([CELLS, PREDICATE]);
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/session/S/actions',
      body: touch(
        { type: 'pointerMove', duration: 0, x: 133, y: 366 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ),
    });
  });

  it('prefers a Files cell named by the label, or by the label and a comma, and taps its icon (upper third)', async () => {
    const { call, sent } = nativeWda(1, 1, 1);
    const input = await openWdaInput(call, fakePage());
    await input.tapNative('Green');
    expect(sent.filter((s) => s.path === '/session/S/elements')).toHaveLength(1);
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/session/S/actions',
      body: touch(
        { type: 'pointerMove', duration: 0, x: 346, y: 258 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ),
    });
  });

  it('refuses a label two visible cells carry', async () => {
    const { call } = nativeWda(1, 1, 2);
    const input = await openWdaInput(call, fakePage());
    await expect(input.tapNative('Green')).rejects.toThrow('2 visible native elements are labelled "Green"; a tap needs exactly one');
  });

  it('waits for a native list that is still opening, then taps', async () => {
    vi.useFakeTimers();
    const { call, sent, lookups } = nativeWda(3);
    const input = await openWdaInput(call, fakePage());
    const tapped = input.tapNative('Green');
    await vi.advanceTimersByTimeAsync(250);
    await tapped;
    expect(lookups()).toBe(3);
    expect(sent.at(-1)?.path).toBe('/session/S/actions');
  });

  it('fails at its 3 s ceiling naming the label, without tapping', async () => {
    vi.useFakeTimers();
    const { call, sent } = nativeWda(Number.POSITIVE_INFINITY);
    const input = await openWdaInput(call, fakePage());
    const tapped = expect(input.tapNative('Green')).rejects.toThrow(
      'no visible native button or text labelled "Green" appeared within 3000ms',
    );
    await vi.advanceTimersByTimeAsync(3200);
    await tapped;
    expect(sent.some((s) => s.path === '/session/S/actions')).toBe(false);
  });

  it('refuses a label two visible elements carry, naming how many, so a tap never lands on a guess', async () => {
    const { call, sent } = nativeWda(1, 2);
    const input = await openWdaInput(call, fakePage());
    await expect(input.tapNative('Green')).rejects.toThrow('2 visible native elements are labelled "Green"; a tap needs exactly one');
    expect(sent.some((s) => s.path === '/session/S/actions')).toBe(false);
  });

  it('escapes a double quote in the label', async () => {
    const { call, sent } = nativeWda();
    const input = await openWdaInput(call, fakePage());
    await input.tapNative('Say "hi"');
    expect((sent.find((s) => s.path === '/session/S/elements')?.body as { value: string }).value).toContain('label == "Say \\"hi\\""');
  });
});

describe('tapFirstImage', () => {
  const ID = (id: string) => ({ 'element-6066-11e4-a52e-4f735466cecf': id });
  const RECTS: Record<string, { x: number; y: number; width: number; height: number }> = {
    A: { x: 140.6, y: 277.7, width: 138.9, height: 139 },
    B: { x: 0, y: 277.7, width: 138.9, height: 139 },
    C: { x: 0, y: 418.3, width: 138.9, height: 139 },
  };

  function gridWda(appearsOn = 1) {
    const sent: Sent[] = [];
    let lookups = 0;
    const call: WdaCall = (method, path, body) => {
      sent.push({ method, path, body });
      if (path === '/session') return Promise.resolve({ sessionId: 'S' });
      if (path === '/session/S/elements') {
        lookups += 1;
        return Promise.resolve(lookups < appearsOn ? [] : [ID('A'), ID('B'), ID('C')]);
      }
      const rect = /^\/session\/S\/element\/(\w)\/rect$/.exec(path)?.[1];
      if (rect !== undefined) return Promise.resolve(RECTS[rect]);
      return Promise.resolve(null);
    };
    return { call, sent };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('taps the centre of the topmost, then leftmost, visible image with the identifier', async () => {
    const { call, sent } = gridWda();
    const input = await openWdaInput(call, fakePage());
    await input.tapFirstImage('PXGGridLayout-Info');
    expect(sent.find((s) => s.path === '/session/S/elements')?.body).toEqual({
      using: 'predicate string',
      value: 'type == "XCUIElementTypeImage" AND name == "PXGGridLayout-Info" AND visible == 1',
    });
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/session/S/actions',
      body: touch(
        { type: 'pointerMove', duration: 0, x: 69, y: 347 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ),
    });
  });

  it('waits for the grid to appear, and fails at the ceiling naming the identifier', async () => {
    vi.useFakeTimers();
    const { call, sent } = gridWda(Number.POSITIVE_INFINITY);
    const input = await openWdaInput(call, fakePage());
    const tapped = expect(input.tapFirstImage('PXGGridLayout-Info')).rejects.toThrow(
      'no visible image "PXGGridLayout-Info" appeared within 3000ms',
    );
    await vi.advanceTimersByTimeAsync(3200);
    await tapped;
    expect(sent.some((s) => s.path === '/session/S/actions')).toBe(false);
  });
});

describe('wdaHttp', () => {
  it('sends JSON and returns the reply value', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ value: { ok: 1 } }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(wdaHttp('http://127.0.0.1:8101')('POST', '/x', { a: 1 })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8101/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('names the method, path and status when WebDriverAgent refuses', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ value: { error: 'boom' } }), { status: 500 })));
    await expect(wdaHttp('http://127.0.0.1:8101')('POST', '/x')).rejects.toThrow('WDA POST /x 500: {"error":"boom"}');
  });
});
