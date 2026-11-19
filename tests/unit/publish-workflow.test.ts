import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock } from './source-text.ts';

/**
 * Publishing @shyden-labs/playwright-devices to npmjs.com (Shyden 2026-11-18 on
 * shyden-labs/playwright-devices#16: the registry, with trusted publishing). GitHub Actions signs in
 * to npm through OIDC, so no npm token is stored, and npm attaches provenance itself
 * (docs.npmjs.com/trusted-publishers). The `npm` environment carries Shyden's approval.
 */
const source = readFileSync('.github/workflows/publish.yml', 'utf8');
const workflow = withoutYamlQuotes(withoutYamlComments(source));
const jobs = yamlBlock(workflow, 'jobs');
const build = yamlBlock(jobs, 'build', '  ');
const publish = yamlBlock(jobs, 'publish', '  ');
const runs = (job: string) =>
  job
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => /^ {6}(?:- | {2})run: (.*)/m.exec(step)?.[1] ?? '')
    .filter((run) => run !== '' && run !== '|');

describe('publish.yml', () => {
  it('runs when a release is published, and on nothing else', () => {
    expect(yamlBlock(workflow, 'on')).toBe('on:\n  release:\n    types: [published]');
  });

  it('has two jobs: build, then publish', () => {
    expect(jobs.split('\n').filter((line) => /^ {2}\S/.test(line))).toEqual(['  build:', '  publish:']);
    expect(publish).toMatch(/^ {4}needs: build$/m);
  });

  it('builds with no OIDC token and no environment, so no dependency code runs where the publish token can be asked for', () => {
    expect(yamlBlock(build, 'permissions', '    ')).toBe('    permissions:\n      contents: read');
    expect(build).not.toMatch(/environment:/);
  });

  it('checks the tag, installs, builds, drops prepare from the manifest, makes the pack folder and packs, in that order', () => {
    expect(build).toContain('name: The release tag is v followed by the package version');
    expect(runs(build)).toEqual([
      'node scripts/npm-ci.ts',
      'npm run build',
      'npm pkg delete scripts.prepare',
      // npm pack writes into --pack-destination but does not create it: without the folder it exits
      // 254 with ENOENT (the v0.1.1 publish run, 2026-11-19, and measured locally the same day).
      'mkdir -p package',
      'npm pack --pack-destination package',
    ]);
    expect(build).toMatch(/uses: actions\/upload-artifact@/);
  });

  it('publishes the packed tarball alone, in the npm environment where Shyden approves it: only the Node pin is checked out, nothing installed', () => {
    expect(yamlBlock(publish, 'permissions', '    ')).toBe('    permissions:\n      contents: read\n      id-token: write');
    expect(publish).toMatch(/^ {4}environment: npm$/m);
    expect(publish).toMatch(/^ {10}sparse-checkout: docker\/node\/Dockerfile\n {10}sparse-checkout-cone-mode: false$/m);
    expect(publish).not.toMatch(/npm ci|npm-ci|npm install|npm run/);
    expect(publish).toMatch(/uses: actions\/download-artifact@/);
    // `./` makes npm read a file: `package/<name>.tgz` alone is parsed as a GitHub owner/repo and
    // fetched over git (the v0.1.2 run, 2026-11-19; npm-package-arg gives type git vs file).
    expect(runs(publish)).toEqual(['npm publish ./package/*.tgz --access public']);
  });

  it('points setup-node at the npm registry, which trusted publishing signs in to', () => {
    expect(publish).toMatch(/^ {10}registry-url: https:\/\/registry\.npmjs\.org$/m);
  });

  it('uses no stored token: trusted publishing signs in through OIDC', () => {
    expect(source).not.toMatch(/secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/);
  });
});

describe('package.json, for npm', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;

  it('can be published: not private, with a semver version', () => {
    expect(pkg['private']).toBeUndefined();
    expect(pkg['version']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the repository exactly, which trusted publishing matches against', () => {
    expect(pkg['repository']).toEqual({ type: 'git', url: 'git+https://github.com/shyden-labs/playwright-devices.git' });
  });

  it('publishes the scoped package publicly', () => {
    expect(pkg['publishConfig']).toEqual({ access: 'public' });
  });
});
