/**
 * Everything `playwright-devices` does outside its own process
 * (shyden-labs/playwright-devices#54), behind one interface so the command's
 * logic is unit-tested without starting a process or opening a socket.
 */

/** A process started in the background. */
export interface Spawned {
  pid: number;
  /** Its exit code once it ends (a signal counts as 128 + its number). */
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
}

export interface SpawnOptions {
  /** Where its stdout and stderr go; none means they are dropped. */
  logFile?: string;
  env?: NodeJS.ProcessEnv;
  /** The project's own command: it shares this terminal. */
  inherit?: boolean;
}

export interface Spawner {
  spawn(command: string, args: string[], options: SpawnOptions): Spawned;
  /** Runs a command to its end, answering its exit code and output. */
  run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  /** One HTTP request with a short ceiling; the body, or null when nothing answered. */
  request(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** A line for the person running the command (stderr). */
  print(line: string): void;
}
