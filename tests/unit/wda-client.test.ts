import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWda, type WdaClock } from '../../src/devices/wda-client.ts';

/** One HTTP call the client made to WebDriverAgent. */
interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A WebDriverAgent stand-in: answers by `METHOD path`, records every call. */
function fakeWda(answers: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: decodeURIComponent(url.pathname),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const answer = answers[`${call.method} ${call.path}`];
    if (!answer) return Promise.resolve(new Response(JSON.stringify({ value: { error: 'unknown command' } }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify({ value: answer(call) }), { status: 200 }));
  };
  return { calls, fetchFn };
}

/** No wait in the client is longer than this, so a fake clock past it means a wait without a ceiling. */
const LONGEST_CEILING_MS = 60_000;

/** A clock that only moves when the client sleeps. */
function fakeClock(): WdaClock {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      if (t > LONGEST_CEILING_MS)
        return Promise.reject(new Error(`the client waited past ${LONGEST_CEILING_MS} ms: a wait has no ceiling`));
      return Promise.resolve();
    },
  };
}

const session = { 'POST /session': () => ({ sessionId: 's1', capabilities: {} }) };

describe('pressKey (shyden-labs/playwright-devices#67)', () => {
  it("presses the on-screen keyboard's return key for Enter, once the keyboard is listed", async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/elements': () => [{ ELEMENT: 'kb' }], 'POST /session/s1/wda/keys': () => null });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.pressKey('Enter');

    expect(wda.calls.find((c) => c.path === '/session/s1/wda/keys')?.body).toEqual({ value: ['\n'] });
  });

  it('refuses Escape, which the iPhone has no key for, and any other key, naming it and sending nothing', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/elements': () => [{ ELEMENT: 'kb' }], 'POST /session/s1/wda/keys': () => null });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await expect(client.pressKey('Escape')).rejects.toThrow(
      'the iPhone has no Escape key: its on-screen keyboard has none; close what Escape would close by a real tap instead',
    );
    await expect(client.pressKey('Tab')).rejects.toThrow('no real key on the iPhone for "Tab"; keys routed: Enter');
    expect(wda.calls.filter((c) => c.path === '/session/s1/wda/keys')).toEqual([]);
  });
});

describe('typeText', () => {
  it('sends the keys only once the on-screen keyboard is listed', async () => {
    let keyboardLooks = 0;
    const wda = fakeWda({
      ...session,
      'POST /session/s1/elements': () => {
        keyboardLooks += 1;
        return keyboardLooks < 3 ? [] : [{ ELEMENT: 'kb' }];
      },
      'POST /session/s1/wda/keys': () => null,
    });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.typeText('héllo');

    const keys = wda.calls.findIndex((c) => c.path === '/session/s1/wda/keys');
    const looks = wda.calls.filter((c) => c.path === '/session/s1/elements');
    expect(looks).toHaveLength(3);
    expect(looks[0]?.body).toEqual({ using: 'class name', value: 'XCUIElementTypeKeyboard' });
    expect(keys).toBeGreaterThan(wda.calls.lastIndexOf(looks[2] as Call));
    expect(wda.calls[keys]?.body).toEqual({ value: ['h', 'é', 'l', 'l', 'o'] });
  });

  it('fails at 15 s naming the keyboard when it never shows, and sends no keys', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/elements': () => [], 'POST /session/s1/wda/keys': () => null });
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    await expect(client.typeText('a')).rejects.toThrow('the on-screen keyboard did not show within 15000 ms; no keys were sent');
    expect(clock.now()).toBe(15_000);
    expect(wda.calls.some((c) => c.path.endsWith('/wda/keys'))).toBe(false);
  });
});

describe('a refused command', () => {
  it('throws naming the method, the path, the status and WebDriverAgent’s message', async () => {
    const wda = fakeWda(session);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await expect(client.typeText('a')).rejects.toThrow('WebDriverAgent refused POST /session/s1/elements (404): unknown command');
  });
});

/** WebDriverAgent answering everything but a tap, which it holds until the client gives up (iPad simulator, 2026-11-20 run 2: 152 s). */
function tapNeverAnswered() {
  const answered = fakeWda({ ...session });
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (init?.method !== 'POST' || !path.endsWith('/actions')) return answered.fetchFn(input, init);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason as Error);
      });
    });
  };
}

describe('a command WebDriverAgent never answers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails at the request ceiling naming the method and the path', async () => {
    const client = await connectWda({
      url: 'http://127.0.0.1:8100',
      fetchFn: tapNeverAnswered(),
      clock: fakeClock(),
      requestCeilingMs: 20,
    });

    await expect(client.tapAt({ x: 1, y: 1 })).rejects.toThrow('WebDriverAgent did not answer POST /session/s1/actions within 20 ms');
  });

  it('gives up after 30 s by default, not before', async () => {
    vi.useFakeTimers();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: tapNeverAnswered(), clock: fakeClock() });
    let settled = false;
    const tap = client.tapAt({ x: 1, y: 1 }).finally(() => {
      settled = true;
    });
    const failure = expect(tap).rejects.toThrow('WebDriverAgent did not answer POST /session/s1/actions within 30000 ms');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
  });
});

/** The W3C touch a real finger makes: down at (x, y), a short hold, then up. */
function touchTap(x: number, y: number) {
  return {
    actions: [
      {
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 50 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  };
}

describe('tapAt', () => {
  it('sends one W3C touch tap at the screen point, rounded to whole points', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/actions': () => null });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.tapAt({ x: 120.4, y: 300.6 });

    expect(wda.calls.filter((c) => c.path === '/session/s1/actions').map((c) => c.body)).toEqual([touchTap(120, 301)]);
  });
});

describe('swipe', () => {
  // W3C /actions went unanswered for 30 s after the iPad photo picker closed, while this endpoint answered
  // in 1.8 s (iPad Pro 13) and 3.3 s (iPad mini) and the page scrolled (run 44974365844, 2026-11-22).
  it("drags one finger from the start point to the end point over 0.3 s through WebDriverAgent's drag endpoint", async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/wda/dragfromtoforduration': () => null });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.swipe({ x: 200.4, y: 600.6 }, { x: 200, y: 200 });

    expect(wda.calls.filter((c) => c.path.startsWith('/session/s1/')).map((c) => [c.path, c.body])).toEqual([
      ['/session/s1/wda/dragfromtoforduration', { fromX: 200, fromY: 601, toX: 200, toY: 200, duration: 0.3 }],
    ]);
  });
});

describe('tapFirstShown', () => {
  /** WebDriverAgent listing only the labels in `shown`, the n-th look onwards. */
  function screenWith(shown: string[], fromLook = 1) {
    let looks = 0;
    return fakeWda({
      ...session,
      'POST /session/s1/elements': (call) => {
        looks += 1;
        const label = /^label == "(.*)"$/.exec((call.body as { value: string }).value)?.[1] ?? '';
        return looks >= fromLook && shown.includes(label) ? [{ ELEMENT: `el-${label}` }] : [];
      },
      'POST /session/s1/element/el-On My iPad/click': () => null,
      'POST /session/s1/element/el-Browse/click': () => null,
    });
  }

  it('taps whichever of the labels shows, so one step serves the iPhone and the iPad', async () => {
    const wda = screenWith(['On My iPad']);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    const tapped = await client.tapFirstShown(['Browse', 'On My iPhone', 'On My iPad']);

    expect(tapped).toBe('On My iPad');
    expect(wda.calls.filter((c) => c.path.endsWith('/click')).map((c) => c.path)).toEqual(['/session/s1/element/el-On My iPad/click']);
    expect(wda.calls.find((c) => c.path === '/session/s1/elements')?.body).toEqual({
      using: 'predicate string',
      value: 'label == "Browse"',
    });
  });

  it('prefers the earlier label when several show', async () => {
    const wda = screenWith(['On My iPad', 'Browse']);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    expect(await client.tapFirstShown(['Browse', 'On My iPad'])).toBe('Browse');
  });

  it('keeps looking while a slow picker opens (listed at t+26 s on the simulator)', async () => {
    const wda = screenWith(['Browse'], 200);
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    expect(await client.tapFirstShown(['Browse'])).toBe('Browse');
    expect(clock.now()).toBeGreaterThan(9_000);
  });

  it('fails at 60 s naming every label it looked for, and taps nothing', async () => {
    const wda = screenWith([]);
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    await expect(client.tapFirstShown(['Browse', 'On My iPad'])).rejects.toThrow(
      'none of "Browse", "On My iPad" showed within 60000 ms; nothing was tapped',
    );
    expect(clock.now()).toBe(60_000);
    expect(wda.calls.some((c) => c.path.endsWith('/click'))).toBe(false);
  });
});

describe('close', () => {
  it('deletes the session it created, and nothing else', async () => {
    const wda = fakeWda({ ...session, 'DELETE /session/s1': () => null });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.close();

    expect(wda.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /session', 'DELETE /session/s1']);
  });
});

describe('rectOf', () => {
  /** A screen whose element `label` is listed from the `shownFromLook`th look on. */
  function screenWithRect(label: string, rect: object, shownFromLook = 1) {
    let looks = 0;
    return fakeWda({
      ...session,
      'POST /session/s1/elements': (call) => {
        looks += 1;
        const body = call.body as { using: string; value: string };
        return body.using === 'accessibility id' && body.value === label && looks >= shownFromLook ? [{ ELEMENT: 'm1' }] : [];
      },
      'GET /session/s1/element/m1/rect': () => rect,
    });
  }

  it('answers the screen rectangle of the element with that accessibility id', async () => {
    const wda = screenWithRect('marker', { x: 0, y: 68, width: 100, height: 100 });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    expect(await client.rectOf('marker')).toEqual({ x: 0, y: 68, width: 100, height: 100 });
    expect(wda.calls.at(-1)).toMatchObject({ method: 'GET', path: '/session/s1/element/m1/rect' });
  });

  it('keeps looking while the element is not yet listed', async () => {
    const wda = screenWithRect('marker', { x: 0, y: 68, width: 100, height: 100 }, 4);
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    expect(await client.rectOf('marker')).toEqual({ x: 0, y: 68, width: 100, height: 100 });
    expect(wda.calls.filter((c) => c.path === '/session/s1/elements')).toHaveLength(4);
  });

  it('fails at 5 s naming the element when it is never listed, and reads no rectangle', async () => {
    const wda = screenWithRect('marker', {}, Number.POSITIVE_INFINITY);
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    await expect(client.rectOf('marker')).rejects.toThrow('no element with accessibility id "marker" showed within 5000 ms');
    expect(clock.now()).toBe(5_000);
    expect(wda.calls.some((c) => c.path.endsWith('/rect'))).toBe(false);
  });
});

describe('windowSize', () => {
  it('answers the screen size in points', async () => {
    const wda = fakeWda({ ...session, 'GET /session/s1/window/size': () => ({ width: 420, height: 912 }) });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    expect(await client.windowSize()).toEqual({ width: 420, height: 912 });
  });
});

describe('tapTopLeftOf', () => {
  const grid = "type == 'XCUIElementTypeImage' AND name == 'PXGGridLayout-Info'";
  /** Three grid images; listed from the `shownFromLook`th look on. */
  function photoGrid(shownFromLook = 1) {
    let looks = 0;
    return fakeWda({
      ...session,
      'POST /session/s1/elements': () => {
        looks += 1;
        return looks >= shownFromLook ? [{ ELEMENT: 'a' }, { ELEMENT: 'c' }, { ELEMENT: 'b' }] : [];
      },
      'GET /session/s1/element/a/rect': () => ({ x: 200, y: 100, width: 100, height: 100 }),
      'GET /session/s1/element/b/rect': () => ({ x: 100, y: 100, width: 100, height: 100 }),
      'GET /session/s1/element/c/rect': () => ({ x: 0, y: 200, width: 100, height: 100 }),
      'POST /session/s1/actions': () => null,
    });
  }

  it('taps the centre of the topmost, then leftmost, element the predicate matches', async () => {
    const wda = photoGrid();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.tapTopLeftOf(grid);

    expect(wda.calls.find((c) => c.path === '/session/s1/elements')?.body).toEqual({ using: 'predicate string', value: grid });
    const tap = wda.calls.find((c) => c.path === '/session/s1/actions')?.body as { actions: { actions: object[] }[] };
    expect(tap.actions[0]?.actions[0]).toEqual({ type: 'pointerMove', duration: 0, x: 150, y: 150 });
  });

  it('keeps looking while the picker opens', async () => {
    const wda = photoGrid(5);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.tapTopLeftOf(grid);

    expect(wda.calls.filter((c) => c.path === '/session/s1/elements')).toHaveLength(5);
  });

  it('fails at 60 s naming the predicate, and taps nothing', async () => {
    const wda = photoGrid(Number.POSITIVE_INFINITY);
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    await expect(client.tapTopLeftOf(grid)).rejects.toThrow(`nothing matching ${grid} showed within 60000 ms; nothing was tapped`);
    expect(clock.now()).toBe(60_000);
    expect(wda.calls.some((c) => c.path.endsWith('/actions'))).toBe(false);
  });
});

describe('tapIfShown', () => {
  /** WebDriverAgent listing only the labels in `shown`. */
  function screenWith(shown: string[]) {
    return fakeWda({
      ...session,
      'POST /session/s1/elements': (call) => {
        const label = /^label == "(.*)"$/.exec((call.body as { value: string }).value)?.[1] ?? '';
        return shown.includes(label) ? [{ ELEMENT: `el-${label}` }] : [];
      },
      'POST /session/s1/element/el-Cancel/click': () => null,
    });
  }

  it('taps the label when the screen lists it, and answers the label', async () => {
    const wda = screenWith(['Cancel']);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    expect(await client.tapIfShown(['Done', 'Cancel'])).toBe('Cancel');
    expect(wda.calls.filter((c) => c.path.endsWith('/click')).map((c) => c.path)).toEqual(['/session/s1/element/el-Cancel/click']);
  });

  it('looks once, without waiting, and taps nothing when no label shows', async () => {
    const wda = screenWith([]);
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    expect(await client.tapIfShown(['Cancel', 'Done'])).toBeUndefined();
    expect(clock.now()).toBe(0);
    expect(wda.calls.filter((c) => c.path === '/session/s1/elements')).toHaveLength(2);
    expect(wda.calls.some((c) => c.path.endsWith('/click'))).toBe(false);
  });
});

describe('tapCellIcon', () => {
  /** WebDriverAgent listing the Files grid as measured on the iPhone Air (2026-11-20), from the n-th look onwards. */
  function filesGrid(fromLook = 1) {
    let looks = 0;
    return fakeWda({
      ...session,
      'POST /session/s1/elements': (call) => {
        looks += 1;
        const { value } = call.body as { value: string };
        return looks >= fromLook && value === "type == 'XCUIElementTypeCell' AND label BEGINSWITH 'WebDriverAgentRunner-Runner, '"
          ? [{ ELEMENT: 'cell-1' }]
          : [];
      },
      'GET /session/s1/element/cell-1/rect': () => ({ x: 282, y: 200, width: 128, height: 176 }),
      'POST /session/s1/actions': () => null,
    });
  }

  it('taps the icon of the cell named so (a quarter down the cell): Files ignores a tap on the name', async () => {
    const wda = filesGrid();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.tapCellIcon('WebDriverAgentRunner-Runner');

    expect(wda.calls.find((c) => c.path === '/session/s1/actions')?.body).toEqual(touchTap(346, 244));
  });

  it('taps only once the cell has stopped moving: a view sliding in moves its cells (CI, 2026-11-21)', async () => {
    // On a fast runner the folder cell was found 0.4 s after On My iPhone opened, still sliding in, and
    // the tap at its first position opened nothing (devices-sim run 44882233599, shyden-labs/playwright-devices#38).
    const positions = [{ x: 700 }, { x: 420 }, { x: 282 }, { x: 282 }];
    let reads = 0;
    const wda = fakeWda({
      ...session,
      'POST /session/s1/elements': () => [{ ELEMENT: 'cell-1' }],
      'GET /session/s1/element/cell-1/rect': () => ({
        ...positions[Math.min(reads++, positions.length - 1)],
        y: 200,
        width: 128,
        height: 176,
      }),
      'POST /session/s1/actions': () => null,
    });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.tapCellIcon('WebDriverAgentRunner-Runner');

    const taps = wda.calls.filter((c) => c.path === '/session/s1/actions');
    expect(taps.map((c) => c.body)).toEqual([touchTap(346, 244)]);
  });

  it('fails naming the cell when it never stops moving within 10 s, tapping nothing', async () => {
    let reads = 0;
    const wda = fakeWda({
      ...session,
      'POST /session/s1/elements': () => [{ ELEMENT: 'cell-1' }],
      'GET /session/s1/element/cell-1/rect': () => ({ x: (reads += 1), y: 200, width: 128, height: 176 }),
    });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await expect(client.tapCellIcon('device-journey')).rejects.toThrow(
      'the cell named "device-journey" was still moving after 10000 ms; nothing was tapped',
    );
    expect(wda.calls.some((c) => c.path.endsWith('/actions'))).toBe(false);
  });

  it('waits while the folder lists, and fails at 60 s naming the cell, tapping nothing', async () => {
    const slow = filesGrid(50);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: slow.fetchFn, clock: fakeClock() });
    await client.tapCellIcon('WebDriverAgentRunner-Runner');

    const never = fakeWda({ ...session, 'POST /session/s1/elements': () => [] });
    const clock = fakeClock();
    const stuck = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: never.fetchFn, clock });
    await expect(stuck.tapCellIcon('device-journey')).rejects.toThrow(
      'no cell named "device-journey" showed within 60000 ms; nothing was tapped',
    );
    expect(clock.now()).toBe(60_000);
    expect(never.calls.some((c) => c.path.endsWith('/actions'))).toBe(false);
  });
});

describe('a look while the view changes', () => {
  /** Measured on the iPad simulator, 2026-11-20: the look right after tapping Browse. */
  const STALE =
    'The previously found element ""Browse" Button" is not present in the current view anymore. Make sure the application UI has the expected state.';

  it('counts WebDriverAgent’s stale-view refusal as nothing shown yet, and keeps waiting', async () => {
    let looks = 0;
    const calls: string[] = [];
    const fetchFn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = decodeURIComponent(new URL(input instanceof Request ? input.url : input).pathname);
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/session') return Promise.resolve(Response.json({ value: { sessionId: 's1' } }));
      if (path === '/session/s1/elements') {
        looks += 1;
        if (looks === 1) return Promise.resolve(Response.json({ value: { error: 'no such element', message: STALE } }, { status: 404 }));
        return Promise.resolve(Response.json({ value: [{ ELEMENT: 'el-ipad' }] }));
      }
      return Promise.resolve(Response.json({ value: null }));
    };
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn, clock: fakeClock() });

    expect(await client.tapFirstShown(['On My iPad'])).toBe('On My iPad');
    expect(calls.at(-1)).toBe('POST /session/s1/element/el-ipad/click');
  });

  it('still fails on any other refusal, naming it', async () => {
    const fetchFn = (input: string | URL | Request): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === '/session') return Promise.resolve(Response.json({ value: { sessionId: 's1' } }));
      return Promise.resolve(Response.json({ value: { error: 'invalid selector', message: 'bad predicate' } }, { status: 400 }));
    };
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn, clock: fakeClock() });

    await expect(client.tapFirstShown(['On My iPad'])).rejects.toThrow(
      'WebDriverAgent refused POST /session/s1/elements (400): bad predicate',
    );
  });
});

describe('screenshot', () => {
  it('answers the screen as PNG bytes', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const wda = fakeWda({ ...session, 'GET /session/s1/screenshot': () => png.toString('base64') });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    expect(await client.screenshot()).toEqual(png);
  });
});

describe('source', () => {
  it("answers WebDriverAgent's description of the whole screen", async () => {
    const wda = fakeWda({ ...session, 'GET /session/s1/source': () => '<XCUIElementTypeApplication/>' });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    expect(await client.source()).toBe('<XCUIElementTypeApplication/>');
  });
});

describe('waitGone', () => {
  it('waits until nothing matches the predicate: a picker still closing swallows the next swipe', async () => {
    let looks = 0;
    const wda = fakeWda({
      ...session,
      'POST /session/s1/elements': () => {
        looks += 1;
        return looks < 4 ? [{ ELEMENT: 'done' }] : [];
      },
    });
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    await client.waitGone('label == "Done"');

    expect(looks).toBe(4);
    expect(wda.calls.find((c) => c.path === '/session/s1/elements')?.body).toEqual({ using: 'predicate string', value: 'label == "Done"' });
  });

  it('fails at 60 s naming what stayed', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/elements': () => [{ ELEMENT: 'done' }] });
    const clock = fakeClock();
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock });

    await expect(client.waitGone('label == "Done"')).rejects.toThrow('label == "Done" was still on the screen after 60000 ms');
    expect(clock.now()).toBe(60_000);
  });
});

describe('a refusal’s message', () => {
  /** WebDriverAgent refusing every command after the session with `value` as the body. */
  function refusingWith(value: unknown) {
    const answered = fakeWda(session);
    return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === '/session') return answered.fetchFn(input, init);
      return Promise.resolve(new Response(JSON.stringify({ value }), { status: 500 }));
    };
  }

  it('uses WebDriverAgent’s message when it gives one', async () => {
    const client = await connectWda({
      url: 'http://127.0.0.1:8100',
      fetchFn: refusingWith({ error: 'unknown error', message: 'element not visible' }),
      clock: fakeClock(),
    });
    await expect(client.typeText('a')).rejects.toThrow('WebDriverAgent refused POST /session/s1/elements (500): element not visible');
  });

  it('says there was no message when the refusal carries none', async () => {
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: refusingWith(null), clock: fakeClock() });
    await expect(client.typeText('a')).rejects.toThrow('WebDriverAgent refused POST /session/s1/elements (500): no message');
  });
});

describe('an element listed with no id', () => {
  it('fails naming what WebDriverAgent listed, and taps nothing', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/elements': () => [{ rect: 'no id here' }] });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await expect(client.tapFirstShown(['Browse'])).rejects.toThrow('WebDriverAgent listed an element with no id: {"rect":"no id here"}');
    expect(wda.calls.filter((c) => c.path.endsWith('/click'))).toEqual([]);
  });
});

describe("WebDriverAgent's answers in their other shapes", () => {
  /** WebDriverAgent answering `path` with `status` and `value`, and everything else as `fakeWda(session)` does. */
  function answering(path: string, status: number, value: unknown) {
    const rest = fakeWda(session);
    return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === path) return Promise.resolve(Response.json({ value }, { status }));
      return rest.fetchFn(input, init);
    };
  }

  it('names the error WebDriverAgent gives when its refusal has no message', async () => {
    const fetchFn = answering('/session/s1/elements', 500, { error: 'unknown error' });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn, clock: fakeClock() });
    await expect(client.typeText('a')).rejects.toThrow('WebDriverAgent refused POST /session/s1/elements (500): unknown error');
  });

  it('says "no message" when the refusal carries neither a message nor an error', async () => {
    const fetchFn = answering('/session/s1/elements', 500, null);
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn, clock: fakeClock() });
    await expect(client.typeText('a')).rejects.toThrow('WebDriverAgent refused POST /session/s1/elements (500): no message');
  });

  it('reads an element id given under the W3C key', async () => {
    const wda = fakeWda({
      ...session,
      'POST /session/s1/elements': () => [{ 'element-6066-11e4-a52e-4f735466cecf': 'w3c-1' }],
      'GET /session/s1/element/w3c-1/rect': () => ({ x: 1, y: 2, width: 3, height: 4 }),
    });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });
    expect(await client.rectOf('marker')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('fails naming it when WebDriverAgent lists an element with no id', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/elements': () => [{}] });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });
    await expect(client.rectOf('marker')).rejects.toThrow('WebDriverAgent listed an element with no id: {}');
  });
});
