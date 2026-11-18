import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Other projects install this repo as a git dependency (`github:shyden-labs/playwright-devices#<tag>`,
 * Shyden 2026-11-18 on shyden-labs/playwright-devices#16), and `prepare` compiles the one-suite
 * checks to dist/ on install. These pin what they import and run; the install itself was measured
 * once (research/package/install-as-git-dependency-2026-11-18.txt).
 */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
const build = JSON.parse(readFileSync('tsconfig.build.json', 'utf8')) as {
  compilerOptions: { outDir: string };
  include: string[];
};

describe('package.json', () => {
  it('is named for the org, so a project depends on @shyden-labs/playwright-devices', () => {
    expect(pkg['name']).toBe('@shyden-labs/playwright-devices');
  });

  it('exports the checks, the assertion-counting reporter and the desktop browsers from dist, with their types', () => {
    expect(pkg['exports']).toEqual({
      '.': { types: './dist/src/one-suite/check.d.ts', default: './dist/src/one-suite/check.js' },
      './assertion-counter': {
        types: './dist/src/one-suite/assertion-counter.d.ts',
        default: './dist/src/one-suite/assertion-counter.js',
      },
      './desktop': { types: './dist/src/desktop/browsers.d.ts', default: './dist/src/desktop/browsers.js' },
    });
  });

  it('installs the one-suite command from dist', () => {
    expect(pkg['bin']).toEqual({ 'one-suite': './dist/src/one-suite/cli.js' });
  });

  it('ships only dist, which the build writes from the one-suite and desktop sources', () => {
    expect(pkg['files']).toEqual(['dist/']);
    expect(build.compilerOptions.outDir).toBe('dist');
    expect(build.include).toEqual(['src/one-suite/*.ts', 'src/desktop/*.ts']);
  });

  it('takes Playwright from the project, whose reporter types the checks read', () => {
    expect(pkg['peerDependencies']).toEqual({ '@playwright/test': '^1.65.1' });
  });
});

describe('the one-suite command', () => {
  it('starts with a node shebang, which the build keeps, so the installed bin runs under node', () => {
    expect(readFileSync('src/one-suite/cli.ts', 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
  });
});
