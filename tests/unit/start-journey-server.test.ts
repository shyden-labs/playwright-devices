// startJourneyServer's wiring, with the file, the network and the HTTP server stood in: the unit suite
// opens no socket (tests/setup/unit-refusal.ts). What it serves is journeyResponse's, tested in serve.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (request: { url?: string }, response: FakeResponse) => void;

interface FakeResponse {
  writeHead: (status: number, headers: Record<string, string>) => FakeResponse;
  end: (body: string) => void;
}

const fake = vi.hoisted(() => ({
  handler: undefined as Handler | undefined,
  listenedOn: [] as unknown[],
  listenError: undefined as Error | undefined,
  closeError: undefined as Error | undefined,
  readPaths: [] as string[],
}));

vi.mock('node:fs/promises', () => ({
  readFile: (path: string) => {
    fake.readPaths.push(path);
    return Promise.resolve('<p>journey</p>');
  },
}));

vi.mock('node:os', () => ({
  networkInterfaces: () => ({ en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] }),
}));

vi.mock('node:http', () => ({
  createServer: (handler: Handler) => {
    fake.handler = handler;
    let onError: ((error: Error) => void) | undefined;
    return {
      once: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') onError = listener;
      },
      listen: (port: number, host: string, ready: () => void) => {
        fake.listenedOn.push(port, host);
        if (fake.listenError === undefined) ready();
        else onError?.(fake.listenError);
      },
      address: () => ({ port: 50123 }),
      close: (done: (error?: Error) => void) => {
        done(fake.closeError);
      },
    };
  },
}));

const { startJourneyServer } = await import('../../research/devices/serve.ts');

beforeEach(() => {
  fake.handler = undefined;
  fake.listenedOn = [];
  fake.listenError = undefined;
  fake.closeError = undefined;
  fake.readPaths = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startJourneyServer', () => {
  it('reads the page once and serves it on a free port of the LAN address', async () => {
    vi.stubEnv('JOURNEY_HOST_ALIAS', '');
    const server = await startJourneyServer('/pages/journey.html');
    expect(fake.readPaths).toEqual(['/pages/journey.html']);
    expect(fake.listenedOn).toEqual([0, '192.168.1.20']);
    expect(server.baseURL).toBe('http://192.168.1.20:50123');
  });

  it('listens on loopback and names the alias when an emulator reaches the laptop through one', async () => {
    vi.stubEnv('JOURNEY_HOST_ALIAS', '10.0.2.2');
    const server = await startJourneyServer('/pages/journey.html');
    expect(fake.listenedOn).toEqual([0, '127.0.0.1']);
    expect(server.baseURL).toBe('http://10.0.2.2:50123');
  });

  it("answers each request with journeyResponse's status, headers and body", async () => {
    await startJourneyServer('/pages/journey.html');
    const written: unknown[] = [];
    const response: FakeResponse = {
      writeHead: (status, headers) => {
        written.push(status, headers);
        return response;
      },
      end: (body) => written.push(body),
    };
    fake.handler?.({ url: '/journey.html' }, response);
    expect(written[0]).toBe(200);
    expect(written[2]).toBe('<p>journey</p>');
  });

  it('treats a request with no URL as the root, which is not the page', async () => {
    await startJourneyServer('/pages/journey.html');
    const statuses: number[] = [];
    const response: FakeResponse = {
      writeHead: (status) => {
        statuses.push(status);
        return response;
      },
      end: () => undefined,
    };
    fake.handler?.({}, response);
    fake.handler?.({ url: '/' }, response);
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toBe(statuses[1]);
    expect(statuses[0]).not.toBe(200);
  });

  it('fails with the error the server gave when it cannot listen', async () => {
    fake.listenError = new Error('listen EADDRNOTAVAIL');
    await expect(startJourneyServer('/pages/journey.html')).rejects.toThrow('listen EADDRNOTAVAIL');
  });

  it('closes, and fails with the error the server gave when closing fails', async () => {
    const server = await startJourneyServer('/pages/journey.html');
    await expect(server.close()).resolves.toBeUndefined();
    fake.closeError = new Error('Server is not running.');
    await expect(server.close()).rejects.toThrow('Server is not running.');
  });
});
