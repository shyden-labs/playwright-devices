import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../scripts/copy-phone-files.ts';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('copy-phone-files', () => {
  it('copies every picker file into the build, making the folder', () => {
    const from = mkdtempSync(join(tmpdir(), 'phone-files-'));
    const to = join(mkdtempSync(join(tmpdir(), 'dist-')), 'src', 'devices', 'phone-files');
    made.push(from, to);
    writeFileSync(join(from, 'device-journey.txt'), 'a document');
    writeFileSync(join(from, 'device-journey.png'), 'a photo');

    expect(main([from, to])).toBe(0);

    expect(readdirSync(to).sort()).toEqual(['device-journey.png', 'device-journey.txt']);
    expect(readFileSync(join(to, 'device-journey.txt'), 'utf8')).toBe('a document');
  });

  it('refuses anything but the two folders, naming its usage', () => {
    expect(() => main(['only-one'])).toThrow('usage: node scripts/copy-phone-files.ts <from> <to>');
  });
});
