import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
const execFile = vi.fn();
vi.mock('node:child_process', () => ({ spawn, execFile }));
const openSync = vi.fn(() => 7);
const closeSync = vi.fn();
vi.mock('node:fs', () => ({ openSync, closeSync }));
const readFile = vi.fn(() => Promise.resolve('file text'));
const writeFile = vi.fn(() => Promise.resolve());
vi.mock('node:fs/promises', () => ({ readFile, writeFile }));

const { NODE_SPAWNER } = await import('../../src/devices/cli/node-spawner.ts');

/** A child process stand-in: emit 'exit' or 'error' on it. */
function fakeChild(pid?: number) {
  return Object.assign(new EventEmitter(), { pid, kill: vi.fn() });
}

beforeEach(() => {
  spawn.mockReset();
  execFile.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('NODE_SPAWNER.spawn', () => {
  it('starts the process with its output appended to the log, and closes this side of the log', async () => {
    const child = fakeChild(42);
    spawn.mockReturnValue(child);
    const started = NODE_SPAWNER.spawn('iproxy', ['8100', '8100'], { logFile: '/logs/iproxy.log' });

    expect(openSync).toHaveBeenCalledWith('/logs/iproxy.log', 'a');
    expect(spawn).toHaveBeenCalledWith('iproxy', ['8100', '8100'], { env: process.env, stdio: ['ignore', 7, 7] });
    expect(closeSync).toHaveBeenCalledWith(7);
    expect(started.pid).toBe(42);
    child.emit('exit', 0, null);
    expect(await started.exited).toBe(0);
  });

  it("shares the terminal with the project's command, with the environment given", () => {
    spawn.mockReturnValue(fakeChild(42));
    NODE_SPAWNER.spawn('npx', ['playwright', 'test'], { inherit: true, env: { A: '1' } });
    expect(spawn).toHaveBeenCalledWith('npx', ['playwright', 'test'], { env: { A: '1' }, stdio: 'inherit' });
  });

  it('drops the output when no log is named', () => {
    spawn.mockReturnValue(fakeChild(42));
    NODE_SPAWNER.spawn('x', [], {});
    expect(spawn).toHaveBeenCalledWith('x', [], { env: process.env, stdio: 'ignore' });
  });

  it('counts a process stopped by a signal as 128 plus the signal number', async () => {
    const child = fakeChild(42);
    spawn.mockReturnValue(child);
    const started = NODE_SPAWNER.spawn('x', [], {});
    child.emit('exit', null, 'SIGTERM');
    expect(await started.exited).toBe(143);
  });

  it('counts a process that could not start as 127, and has no pid', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const started = NODE_SPAWNER.spawn('missing', [], {});
    child.emit('error', new Error('spawn missing ENOENT'));
    expect(started.pid).toBe(-1);
    expect(await started.exited).toBe(127);
  });

  it('passes the signal to kill', () => {
    const child = fakeChild(42);
    spawn.mockReturnValue(child);
    NODE_SPAWNER.spawn('x', [], {}).kill('SIGINT');
    expect(child.kill).toHaveBeenCalledWith('SIGINT');
  });
});

describe('NODE_SPAWNER.run', () => {
  type Callback = (error: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void;

  it('answers exit code 0 and stdout', async () => {
    execFile.mockImplementationOnce((_c: string, _a: string[], _o: object, callback: Callback) => {
      callback(null, 'out', 'err');
    });
    expect(await NODE_SPAWNER.run('adb', ['devices'])).toEqual({ code: 0, stdout: 'out', stderr: 'err' });
  });

  it("answers the command's own exit code when it fails", async () => {
    execFile.mockImplementationOnce((_c: string, _a: string[], _o: object, callback: Callback) => {
      callback(Object.assign(new Error('failed'), { code: 1 }), '', 'why');
    });
    expect(await NODE_SPAWNER.run('lsof', [])).toEqual({ code: 1, stdout: '', stderr: 'why' });
  });

  it('answers 127 when the command is missing', async () => {
    execFile.mockImplementationOnce((_c: string, _a: string[], _o: object, callback: Callback) => {
      callback(Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' }), '', '');
    });
    expect(await NODE_SPAWNER.run('lsof', [])).toEqual({ code: 127, stdout: '', stderr: '' });
  });
});

describe('NODE_SPAWNER.request', () => {
  it('sends JSON with a 2 s ceiling and answers the body', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{"ok":true}')));
    vi.stubGlobal('fetch', fetchFn);
    expect(await NODE_SPAWNER.request('POST', 'http://127.0.0.1:8100/session', { capabilities: {} })).toBe('{"ok":true}');
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8100/session');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect({ ...init, signal: undefined }).toEqual({
      method: 'POST',
      body: '{"capabilities":{}}',
      headers: { 'content-type': 'application/json' },
      signal: undefined,
    });
  });

  it('sends no body when none is given', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response('ready')));
    vi.stubGlobal('fetch', fetchFn);
    expect(await NODE_SPAWNER.request('GET', 'http://127.0.0.1:8100/status')).toBe('ready');
    const [, init] = fetchFn.mock.calls[0] ?? [];
    expect({ ...init, signal: undefined }).toEqual({ method: 'GET', signal: undefined });
  });

  it('answers null when nothing answers', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    expect(await NODE_SPAWNER.request('GET', 'http://127.0.0.1:8100/status')).toBeNull();
  });
});

describe('NODE_SPAWNER, the rest', () => {
  it('reads a file as UTF-8', async () => {
    expect(await NODE_SPAWNER.readFile('/etc/pf.shyden.conf')).toBe('file text');
    expect(readFile).toHaveBeenCalledWith('/etc/pf.shyden.conf', 'utf8');
  });

  it('writes a file as UTF-8', async () => {
    await NODE_SPAWNER.writeFile('/wda/setup.json', '{}');
    expect(writeFile).toHaveBeenCalledWith('/wda/setup.json', '{}', 'utf8');
  });

  it('keeps time with the real clock', async () => {
    vi.useFakeTimers({ now: 5_000 });
    expect(NODE_SPAWNER.now()).toBe(5_000);
    const slept = NODE_SPAWNER.sleep(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await slept;
    expect(NODE_SPAWNER.now()).toBe(6_000);
  });

  it('prints a line to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    NODE_SPAWNER.print('playwright-devices: hello');
    expect(write).toHaveBeenCalledWith('playwright-devices: hello\n');
    write.mockRestore();
  });
});
