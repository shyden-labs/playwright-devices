import { describe, expect, it } from 'vitest';
import { connectWda, type WdaClock } from '../../research/devices/wda-client.ts';

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
  it('drags one finger from the start point to the end point over 300 ms', async () => {
    const wda = fakeWda({ ...session, 'POST /session/s1/actions': () => null });
    const client = await connectWda({ url: 'http://127.0.0.1:8100', fetchFn: wda.fetchFn, clock: fakeClock() });

    await client.swipe({ x: 200, y: 600 }, { x: 200, y: 200 });

    expect(wda.calls.filter((c) => c.path === '/session/s1/actions').map((c) => c.body)).toEqual([
      {
        actions: [
          {
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: 200, y: 600 },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 300, x: 200, y: 200 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      },
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
