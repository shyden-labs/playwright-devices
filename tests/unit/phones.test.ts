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
    page: 'phone page',
    nativeChoose: (option: string) => {
      calls.push(`choose ${option}`);
      return Promise.resolve();
    },
    nativeChooseFile: () => Promise.resolve(),
    nativeChoosePhoto: () => Promise.resolve(),
    fingerScroll: () => Promise.resolve(),
    screenshot: () => Promise.resolve(Buffer.from('phone screen')),
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

function testInfo(status: string, expectedStatus = 'passed', project = 'iphone') {
  return { project: { name: project }, status, expectedStatus, attach: vi.fn(() => Promise.resolve()) };
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

describe('the phone connection fixture', () => {
  it('connects the project’s phone with the base URL and files, names each native step, then closes and disconnects', async () => {
    const calls: string[] = [];
    connectPhone.mockResolvedValue(connected(calls));
    const files = { document: '/d.txt', photo: '/p.png' };

    await fixture('phoneConnection')(
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
    await expect(
      fixture('phoneConnection')({ baseURL: undefined, phoneFiles: {} }, () => Promise.resolve(), testInfo('passed')),
    ).rejects.toThrow('set use.baseURL to lanBaseURL(<port>): the phone opens pages there');
    expect(connectPhone).not.toHaveBeenCalled();
  });

  it("attaches the phone's own screen when the test failed, and still tears down", async () => {
    const calls: string[] = [];
    connectPhone.mockResolvedValue(connected(calls));
    const info = testInfo('failed');

    await fixture('phoneConnection')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), info);

    expect(info.attach).toHaveBeenCalledWith('device screen at failure', { body: Buffer.from('phone screen'), contentType: 'image/png' });
    expect(calls).toEqual(['session close', 'disconnect']);
  });

  it('disconnects even when closing the session fails', async () => {
    const calls: string[] = [];
    const phone = connected(calls);
    phone.session.close = () => Promise.reject(new Error('picker stuck'));
    connectPhone.mockResolvedValue(phone);

    await expect(
      fixture('phoneConnection')({ baseURL: 'http://192.168.1.3:4173', phoneFiles: {} }, () => Promise.resolve(), testInfo('passed')),
    ).rejects.toThrow('picker stuck');
    expect(calls).toEqual(['disconnect']);
  });

  it('connects nothing on a desktop project, which needs no base URL, and hands no phone (shyden-labs/playwright-devices#68)', async () => {
    const handed: unknown[] = [];

    await fixture('phoneConnection')(
      { baseURL: undefined, phoneFiles: {} },
      (value) => {
        handed.push(value);
        return Promise.resolve();
      },
      testInfo('failed', 'passed', 'chromium'),
    );

    expect(handed).toEqual([undefined]);
    expect(connectPhone).not.toHaveBeenCalled();
  });
});

/** Runs fixture `name` with `args` and answers what it handed the test. */
async function handedBy(name: string, args: Record<string, unknown>, project = 'iphone'): Promise<unknown> {
  let handed: unknown;
  await fixture(name)(
    args,
    (value) => {
      handed = value;
      return Promise.resolve();
    },
    testInfo('passed', 'passed', project),
  );
  return handed;
}

describe('the page fixture (shyden-labs/playwright-devices#68)', () => {
  it("is the phone's page on a phone project", async () => {
    expect(await handedBy('page', { page: 'desktop page', phoneConnection: { page: 'phone page' } })).toBe('phone page');
  });

  it("is Playwright's own page on a desktop project, a tap there being a real click", async () => {
    const calls: string[] = [];
    const button = { click: () => Promise.resolve(void calls.push('click')) };
    const page = (await handedBy('page', { page: { getByRole: () => button }, phoneConnection: undefined }, 'chromium')) as {
      getByRole: (role: string) => { tap: () => Promise<void> };
    };

    await page.getByRole('button').tap();

    expect(calls).toEqual(['click']);
  });
});

describe('the session fixture (shyden-labs/playwright-devices#68)', () => {
  it("is the phone's session on a phone project", async () => {
    const phone = { page: 'phone page' };
    expect(await handedBy('session', { phoneConnection: phone, page: 'phone page', phoneFiles: {} })).toBe(phone);
  });

  it("is a desktop session on Playwright's page on a desktop project, its file steps using the picker files", async () => {
    const page = { on: () => page, off: () => page };
    const session = (await handedBy(
      'session',
      { phoneConnection: undefined, page, phoneFiles: { document: '/d.txt', photo: '/p.png' } },
      'chromium',
    )) as {
      page: unknown;
      close: () => Promise<void>;
    };

    expect(session.page).toBe(page);
    await expect(session.close()).resolves.toBeUndefined();
  });
});

describe('the fixtures handed to a test', () => {
  it("are the session's steps", async () => {
    const session = { nativeChoose: 'c', nativeChooseFile: 'f', nativeChoosePhoto: 'ph', fingerScroll: 's' };
    const handed: Record<string, unknown> = {};
    for (const [name, key] of [
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
