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
      path: url.pathname,
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
