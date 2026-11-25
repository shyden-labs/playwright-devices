import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { trustedBin, TRUSTED_DIRS } from '../../scripts/trusted-bin.ts';

// The file system is stood in: each test says which commands exist where.
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
const exists = vi.mocked(existsSync);

/**
 * The scripts run gh, git and npm from a full path found in a fixed list of
 * folders, never by a bare name looked up on PATH (SonarCloud S4036; Shyden's
 * rule of 2026-11-25 that every finding is fixed, and his choice of the folder
 * list the same day, issue shyden-labs/playwright-devices#50). ~/.local/bin is
 * on the list because the Mac's gh there is the wrapper that runs agent calls
 * as the project's GitHub App; /opt/homebrew/bin/gh behind it would act as the
 * operator. A command in none of the folders fails naming every one.
 */
describe('trustedBin', () => {
  beforeEach(() => {
    exists.mockReset();
  });

  it('keeps the folder list Shyden chose: ~/.local/bin, then the system folders', () => {
    expect(TRUSTED_DIRS).toEqual([`${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']);
  });

  it('looks beside the running Node first, then in each folder in order', () => {
    exists.mockReturnValue(false);
    expect(() => trustedBin('npm')).toThrow();
    expect(exists.mock.calls.map(([p]) => p)).toEqual([`${dirname(process.execPath)}/npm`, ...TRUSTED_DIRS.map((d) => `${d}/npm`)]);
  });

  it('returns the command beside Node when it is there', () => {
    exists.mockImplementation((p) => p === `${dirname(process.execPath)}/npm`);
    expect(trustedBin('npm')).toBe(`${dirname(process.execPath)}/npm`);
  });

  it("takes the App wrapper in ~/.local/bin over Homebrew's gh", () => {
    exists.mockImplementation((p) => p === `${homedir()}/.local/bin/gh` || p === '/opt/homebrew/bin/gh');
    expect(trustedBin('gh')).toBe(`${homedir()}/.local/bin/gh`);
  });

  it('finds the system gh where only the system has one, as on CI', () => {
    exists.mockImplementation((p) => p === '/usr/bin/gh');
    expect(trustedBin('gh')).toBe('/usr/bin/gh');
  });

  it('fails naming the command and every folder looked in when none holds it', () => {
    exists.mockReturnValue(false);
    expect(() => trustedBin('gh')).toThrow(
      `gh is not installed in any trusted folder (looked in ${[dirname(process.execPath), ...TRUSTED_DIRS].join(', ')})`,
    );
  });
});
