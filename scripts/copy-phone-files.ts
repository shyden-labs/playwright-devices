/**
 * Copies the default picker files into the build (shyden-labs/playwright-devices#54):
 * tsc copies no data files, and the `phones` entry point finds them next to
 * itself. Run by `npm run build`'s postbuild:
 *
 *   node scripts/copy-phone-files.ts <from> <to>
 */
import { cpSync } from 'node:fs';
import { runIfEntry } from './cli.ts';

export function main(args: string[]): number {
  const [from, to, ...rest] = args;
  if (from === undefined || to === undefined || rest.length > 0) throw new Error('usage: node scripts/copy-phone-files.ts <from> <to>');
  cpSync(from, to, { recursive: true });
  return 0;
}

await runIfEntry(import.meta.url, main);
