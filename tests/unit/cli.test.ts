import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIfEntry } from '../../scripts/cli.ts';

/**
 * Every script's command-line entry goes through `runIfEntry`, so the branch
 * that decides "was I started, or imported?" lives in one place and is tested
 * here in-process, with a stand-in for `process` (issue shyden-labs/repo-template#32: every line runs,
 * and a unit test starts no process).
 */

const SCRIPT = '/repo/scripts/tool.ts';
const URL_OF_SCRIPT = pathToFileURL(SCRIPT).href;

/** A stand-in `process` and `main`, each recording what it was given. */
function harness(argv: string[]) {
  const exits: number[] = [];
  const ran: string[][] = [];
  return {
    proc: { argv, exit: (code: number) => void exits.push(code) },
    main: (args: string[]) => (ran.push(args), 3),
    exits,
    ran,
  };
}

describe('runIfEntry', () => {
  it('runs main with the arguments after the script, and exits with its code', async () => {
    const h = harness(['node', SCRIPT, 'a', 'b']);
    await runIfEntry(URL_OF_SCRIPT, h.main, h.proc);
    expect(h.ran).toEqual([['a', 'b']]);
    expect(h.exits).toEqual([3]);
  });

  it('waits for an async main, then exits with the code it resolves to', async () => {
    const h = harness(['node', SCRIPT]);
    await runIfEntry(URL_OF_SCRIPT, () => Promise.resolve(4), h.proc);
    expect(h.exits).toEqual([4]);
  });

  it('runs main when the program is a symlink to the script, as an installed bin is', async () => {
    // npm starts a package's bin through node_modules/.bin/<name>, a symlink: node gives the link
    // as argv[1] and the real file as import.meta.url (measured 2026-11-18).
    // import.meta.url is always the real path; macOS's tmpdir is itself behind a link (/var).
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'run-if-entry-')));
    try {
      const script = join(dir, 'cli.js');
      const link = join(dir, 'one-suite');
      writeFileSync(script, '');
      symlinkSync(script, link);
      const h = harness(['node', link, 'x']);
      await runIfEntry(pathToFileURL(script).href, h.main, h.proc);
      expect(h.ran).toEqual([['x']]);
      expect(h.exits).toEqual([3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when another file is the program (the script was imported)', async () => {
    const h = harness(['node', '/repo/node_modules/vitest/vitest.mjs']);
    await runIfEntry(URL_OF_SCRIPT, h.main, h.proc);
    expect(h.ran).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it('does nothing when there is no program path at all', async () => {
    const h = harness(['node']);
    await runIfEntry(URL_OF_SCRIPT, h.main, h.proc);
    expect(h.ran).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it('defaults to the real process, which a test file is never the entry of', async () => {
    const h = harness([]);
    await runIfEntry(URL_OF_SCRIPT, h.main);
    expect(h.ran).toEqual([]);
  });
});
