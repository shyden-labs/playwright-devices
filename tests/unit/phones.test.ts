import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fixture = (args: Record<string, unknown>, use: (value: unknown) => Promise<void>, testInfo: object) => Promise<void>;

const step = vi.fn((_name: string, body: () => Promise<void>) => body());
vi.mock('@playwright/test', () => ({
  test: { extend: (definitions: Record<string, unknown>) => ({ definitions }), step },
  expect: 'playwright expect',
}));
const connectPhone = vi.fn();
vi.mock('../../src/devices/phone-connect.ts', () => ({ connectPhone }));
vi.mock('../../src/devices/phone-effects.ts', () => ({ REAL_EFFECTS: 'real effects' }));

const phones = await import('../../src/devices/phones.ts');
const { definitions } = phones.test as unknown as { definitions: Record<string, unknown> };
const fixture = (name: string) => definitions[name] as Fixture;

/** A connected phone whose every step and teardown is recorded. */
function connected(calls: string[]) {
  const session = {
    // The page the journey records each touch it saw on, as `window.touchesSeen`.
    page: { evaluate: () => Promise.resolve(['touch at 12,34', 'touch at 56,78']) as Promise<unknown> },
    nativeChoose: (option: string) => {
      calls.push(`choose ${option}`);
      return Promise.resolve();
    },
    nativeChooseFile: () => Promise.resolve(),
    nativeChoosePhoto: () => Promise.resolve(),
    fingerScroll: () => Promise.resolve(),
    screenshot: () => Promise.resolve(Buffer.from('phone screen')),
    screenSource: () => Promise.resolve('<hierarchy/>'),
    moreEvidence: () => Promise.resolve([{ name: 'touches sent', body: '0 ms tap at 1,2' }]),
    close: () => {
      calls.push('session close');
      return Promise.resolve();
    },
  };
  return {
    session,
    disconnect: () => {
      calls.push('disconnect');
      return Promise.resolve();
    },
  };
}

function testInfo(status: string, expectedStatus = 'passed') {
  return { project: { name: 'iphone' }, status, expectedStatus, attach: vi.fn(() => Promise.resolve()) };
}

beforeEach(() => {
  connectPhone.mockReset();
});

describe('the phones entry point', () => {
  it('exports the fixture, expect, the projects, the group, the LAN address and the default files', () => {
    expect(Object.keys(phones).sort()).toEqual(
      ['DEFAULT_PHONE_FILES', 'PHONE_PROJECTS', 'expect', 'lanBaseURL', 'phoneGroup', 'phoneProjects', 'test'].sort(),
    );
    expect(phones.expect).toBe('playwright expect');
  });

  it('ships the default picker files', () => {
    expect(existsSync(phones.DEFAULT_PHONE_FILES.document)).toBe(true);
    expect(existsSync(phones.DEFAULT_PHONE_FILES.photo)).toBe(true);
  });

  it('offers the picker files as an option defaulting to the shipped ones', () => {
    expect(definitions.phoneFiles).toEqual([phones.DEFAULT_PHONE_FILES, { option: true }]);
  });
});

describe('the session fixture', () => {
  it('connects the project’s phone with the base URL and files, names each native step, then closes and disconnects', async () => {
    const calls: string[] = [];
    connectPhone.mockResolvedValue(connected(calls));
    const files = { document: '/d.txt', photo: '/p.png' };

    await fixture('session')(
      { baseURL: 'http://192.168.1.3:4173', phoneFiles: files },
      async (session) => {
        await (session as { nativeChoose: (o: string) => Promise<void> }).nativeChoose('Green');
      },
      testInfo('passed'),
    );

    expect(connectPhone).toHaveBeenCalledWith('iphone', process.env, 'http://192.168.1.3:4173', files, 'real effects');
    expect(step).toHaveBeenCalledWith('native: choose "Green"', expect.any(Function));
    expect(calls).toEqual(['choose Green', 'session close', 'disconnect']);
  });

  it('refuses a run with no base URL, before connecting', async () => {
    await expect(fixture('session')({ baseURL: undefined, phoneFiles: {} }, () => Promise.resolve(), testInfo('passed'))).rejects.toThrow(
      'set use.baseURL to lanBaseURL(<port>): the phone opens pages there',
    );
    expect(connectPhone).not.toHaveBeenCalled();
  });

  it("attaches the phone's own screen when the test failed, and still tears down", async () => {
    const calls: string[] = [];
    connectPhone.mockResolvedValue(connected(calls));
    const info = testInfo('failed');

    await fixture('session')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), info);

    expect(info.attach).toHaveBeenCalledWith('device screen at failure', { body: Buffer.from('phone screen'), contentType: 'image/png' });
    expect(calls).toEqual(['session close', 'disconnect']);
  });

  it("attaches, on failure, the phone's description of its screen, the touches the page saw and the route's further evidence (shyden-labs/playwright-devices#38)", async () => {
    const calls: string[] = [];
    connectPhone.mockResolvedValue(connected(calls));
    const info = testInfo('failed');

    await fixture('session')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), info);

    expect(info.attach).toHaveBeenCalledWith('device screen source at failure', { body: '<hierarchy/>', contentType: 'text/xml' });
    expect(info.attach).toHaveBeenCalledWith('touches the page saw', { body: 'touch at 12,34\ntouch at 56,78', contentType: 'text/plain' });
    expect(info.attach).toHaveBeenCalledWith('touches sent', { body: '0 ms tap at 1,2', contentType: 'text/plain' });
    expect(calls).toEqual(['session close', 'disconnect']);
  });

  it('says why when the page could not be read for the touches it saw, and attaches the rest', async () => {
    const calls: string[] = [];
    const phone = connected(calls);
    phone.session.page.evaluate = () => Promise.reject(new Error('Target closed'));
    connectPhone.mockResolvedValue(phone);
    const info = testInfo('failed');

    await fixture('session')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), info);

    expect(info.attach).toHaveBeenCalledWith('touches the page saw', {
      body: 'the page could not be read: Error: Target closed',
      contentType: 'text/plain',
    });
    expect(info.attach).toHaveBeenCalledWith('touches sent', { body: '0 ms tap at 1,2', contentType: 'text/plain' });
  });

  it('attaches no evidence when the test passed', async () => {
    connectPhone.mockResolvedValue(connected([]));
    const info = testInfo('passed');

    await fixture('session')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), info);

    expect(info.attach).not.toHaveBeenCalled();
  });

  it('disconnects even when closing the session fails', async () => {
    const calls: string[] = [];
    const phone = connected(calls);
    phone.session.close = () => Promise.reject(new Error('picker stuck'));
    connectPhone.mockResolvedValue(phone);

    await expect(
      fixture('session')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), testInfo('passed')),
    ).rejects.toThrow('picker stuck');
    expect(calls).toEqual(['disconnect']);
  });
});

describe('the fixtures handed to a test', () => {
  it("are the session's page and steps", async () => {
    const session = { page: 'p', nativeChoose: 'c', nativeChooseFile: 'f', nativeChoosePhoto: 'ph', fingerScroll: 's' };
    const handed: Record<string, unknown> = {};
    for (const [name, key] of [
      ['page', 'page'],
      ['nativeChoose', 'nativeChoose'],
      ['nativeChooseFile', 'nativeChooseFile'],
      ['nativeChoosePhoto', 'nativeChoosePhoto'],
      ['fingerScroll', 'fingerScroll'],
    ] as const) {
      await fixture(name)(
        { session },
        (value) => {
          handed[name] = value;
          return Promise.resolve();
        },
        testInfo('passed'),
      );
      expect(handed[name]).toBe(session[key]);
    }
  });
});
