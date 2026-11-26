/**
 * The full path of a command the scripts run (gh, git, npm), found in a fixed
 * list of folders rather than looked up on PATH (SonarCloud S4036; issue
 * shyden-labs/playwright-devices#50). The running Node's own folder comes first,
 * because npm is installed beside Node, on the Mac and on CI alike. Then
 * ~/.local/bin, whose gh on the Mac is the wrapper that runs agent calls as the
 * project's GitHub App (Shyden's choice, 2026-11-25), then the system folders.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const TRUSTED_DIRS = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

export function trustedBin(name: string): string {
  const dirs = [dirname(process.execPath), ...TRUSTED_DIRS];
  const found = dirs.map((d) => join(d, name)).find((p) => existsSync(p));
  if (found === undefined) {
    throw new Error(`${name} is not installed in any trusted folder (looked in ${dirs.join(', ')})`);
  }
  return found;
}
