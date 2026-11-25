/**
 * The real `Spawner` (shyden-labs/playwright-devices#54): Node's child
 * processes, `fetch` and files, and the real clock.
 */
import { execFile, spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { realClock } from '../clock.ts';
import type { Spawner } from './spawner.ts';

/** One look at WebDriverAgent or the Safari proxy may not hang a wait. */
const REQUEST_CEILING_MS = 2_000;
/** The shell's exit code for a command it could not start. */
const NOT_FOUND = 127;

export const NODE_SPAWNER: Spawner = {
  spawn(command, args, { logFile, env = process.env, inherit = false }) {
    const log = logFile === undefined ? undefined : openSync(logFile, 'a');
    const stdio: StdioOptions = inherit ? 'inherit' : log === undefined ? 'ignore' : ['ignore', log, log];
    const child: ChildProcess = spawn(command, args, { env, stdio });
    // The child holds its own copy of the log; this process's is no longer needed.
    if (log !== undefined) closeSync(log);
    const exited = new Promise<number>((resolve) => {
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        resolve(code ?? 128 + constants.signals[signal as NodeJS.Signals]);
      });
      child.once('error', () => {
        resolve(NOT_FOUND);
      });
    });
    return {
      pid: child.pid ?? -1,
      exited,
      kill: (signal) => {
        child.kill(signal);
      },
    };
  },
  run: (command, args) =>
    new Promise((resolve) => {
      execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error === null) resolve({ code: 0, stdout, stderr });
        else resolve({ code: typeof error.code === 'number' ? error.code : NOT_FOUND, stdout, stderr });
      });
    }),
  async request(method, url, body) {
    const sent = body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    try {
      return await (await fetch(url, { method, ...sent, signal: AbortSignal.timeout(REQUEST_CEILING_MS) })).text();
    } catch {
      return null;
    }
  },
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  sleep: (ms) => realClock.sleep(ms),
  now: () => realClock.now(),
  print: (line) => {
    process.stderr.write(`${line}\n`);
  },
};
