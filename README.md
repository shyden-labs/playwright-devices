# Playwright Devices

Research into running one unchanged Playwright test on real phones, their simulators and
emulators, and desktop browsers, with real input.

**Progress:** [Playwright Devices progress page](https://claude.ai/artifact/A7uCrNS5QTmstQ3SCGU2ES),
updated at the end of every work session.

This repository started from the Shyden Labs repo template: CI and repository settings were
in place from day one (shyden-labs/repo-template#149).

## What is here

| File | What it does |
| --- | --- |
| `.github/workflows/ci.yml` | On every pull request and every push to `develop`: install, `node scripts/audit.ts` (`npm audit`: any known vulnerability fails, except one with a dated exception in that script), typecheck, lint, format check and unit tests (`build-and-test`), then coverage as one overall threshold over the TypeScript under `scripts/` (`coverage`). Its first step fails unless the default branch is `develop`. |
| `.github/dependabot.yml` | Version updates for npm, GitHub Actions and the Node pin, each targeting `develop`. |
| `docker/node/Dockerfile` | CI's one exact Node version (`FROM node:<major>.<minor>.<patch>`, then `USER node` so it never runs as root), bumped by Dependabot as a pull request of its own (shyden-labs/repo-template#143). |
| `scripts/npm-ci.ts` | Every workflow installs through it: `npm ci` that fails on any warning npm prints, naming each line (shyden-labs/repo-template#140). |
| `.github/workflows/sonarcloud.yml`, `scripts/sonar-verdict.ts`, `docs/sonarcloud.md` | A reusable SonarCloud scan whose quality gate blocks the pull request. |
| `.github/workflows/publish.yml` | Publishes the package to npm when a release is published, through npm trusted publishing (no stored token), after Shyden approves the `npm` environment (shyden-labs/playwright-devices#16). |
| `.github/workflows/check-release-cut.yml`, `scripts/release-cut.ts`, `docs/release-cut.md` | Proves each pull request into `main` lands exactly a release cut CI tested. |
| `scripts/branch-rules-setup.ts` | Sets the `develop` (squash only) and `main` (merge commit only) rulesets, head-branch deletion, rebase merging off and opens the `dev` environment to every branch (any branch may deploy to dev), and reads each back. |
| `scripts/board-*.ts`, `scripts/file-story.ts`, `.github/ISSUE_TEMPLATE/story.yml`, `docs/project-board.md` | The project board: filing stories, Estimate and Priority fields, the next ticket, progress, and orphaned In Progress tickets. |
| `tests/unit/supply-chain.test.ts` | Actions pinned to SHAs, Dependabot covering every ecosystem and targeting `develop`, Node read from the Dockerfile. |
| `tests/unit/licences.test.ts`, `tests/unit/licences.ts` | Every package in `package-lock.json` has a licence the global rule accepts: permissive if shipped, LGPL or MPL also allowed for build and test tools, GPL, AGPL, SSPL and unknown refused (shyden-labs/repo-template#169). |
| `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.githooks/pre-push`, `docs/static-checks.md` | Strict typecheck, lint and format, in CI and before every push. |
| `package.json` `overrides` | `minimatch` held at 11.0.3, past its ReDoS advisory GHSA-g3hv-75wg-m249, until eslint and typescript-eslint accept minimatch 11 themselves; then remove it (shyden-labs/repo-template#154). |
| `LICENSE`, `NOTICE` | Apache-2.0, the ASF's text verbatim in `LICENSE`; the copyright line in `NOTICE`, as the ASF advises (shyden-labs/repo-template#147). |

## Desktop browsers

`src/desktop/browsers.ts` (`@shyden-labs/playwright-devices/desktop` once installed, below) gives every project the same desktop browsers as Playwright projects (shyden-labs/playwright-devices#17): `chromium`, `chrome` (Google Chrome, the `chrome` channel), `firefox`, `webkit` and `msedge` (Microsoft Edge, the `msedge` channel). Each is a real desktop browser: no phone emulation, no touch. A project imports it into its `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { desktopProjects } from '@shyden-labs/playwright-devices/desktop';

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/desktop-report.json' }]],
  projects: desktopProjects(), // or a declared few, e.g. desktopProjects(['chromium', 'chrome', 'msedge'])
});
```

`playwright.desktop.config.ts` is this sample, run by CI's `desktop-e2e` job on all five browsers. The same names form the desktop group of the one-suite checks: `desktopGroup()` (or `desktopGroup(['chromium', 'chrome', 'msedge'])` for a declared few) is the `groups` value `checkOneSuite` takes, and on the CLI it is `--group desktop=chromium,chrome,firefox,webkit,msedge`. An unknown or repeated browser name is refused, naming it. A browser that cannot start fails the run, naming it and why (Playwright's launch error), and is never dropped from the group: the checks report it as having run no tests. Install the browsers with `npx playwright install --with-deps chromium chrome firefox webkit msedge`.

## Installing it in a project

The one-suite checks (shyden-labs/playwright-devices#16) and the desktop browsers are published to npm as `@shyden-labs/playwright-devices`, compiled to JavaScript with their types.

1. `npm install --save-dev --save-exact @shyden-labs/playwright-devices`. It needs `@playwright/test` 1.65.1 or later in the project, and runs no install script.
2. Count each test's assertions per target with the reporter, next to the JSON reporter: `reporter: [['json'], ['@shyden-labs/playwright-devices/assertion-counter', { outputFile: '<target>-assertions.json', unnamedTarget: '<target>' }]]` (`unnamedTarget` names a run whose project has no name, such as a device run).
3. Check the runs: `npx one-suite --group phones=<targets> --group desktop=<targets> --list <list.json>[=<target>] --report <report.json>[=<target>] --assertions <assertions.json>`. It prints one total per target and every problem, and exits 1 on any problem.
4. In code: `import { checkOneSuite, testsByTarget } from '@shyden-labs/playwright-devices'`, and `desktopProjects` and `desktopGroup` from `@shyden-labs/playwright-devices/desktop`.

### Publishing a version

1. Raise `version` in `package.json` on a branch, and merge it through `develop` and a release cut into `main`.
2. Publish a GitHub release on `main` tagged `v<version>`. `.github/workflows/publish.yml` checks the tag matches, builds, and publishes to npm once Shyden approves the `npm` environment. It uses npm trusted publishing, so no npm token is stored, and npm attaches provenance.

## The rules

1. **Pin actions to full commit SHAs**, with a trailing `# vX.Y.Z` comment so a Dependabot bump is reviewable.
2. **Dependabot covers every ecosystem and `github-actions`, targeting `develop`.**
3. **`develop` is the default branch**, because GitHub opens Dependabot security fixes against the default branch only.
4. **Warnings are build failures**: a vite or node warning fails the unit run.
5. **A unit test runs in under 1 s and starts no process and opens no connection** (`tests/setup/unit-refusal.ts`).
6. **Comments and docs cite issues in full**, as `owner/repo#N`, never a bare `#N` (`tests/unit/issue-refs.test.ts`; shyden-labs/repo-template#146). A repository made from this template copies every file, so a template reference such as `shyden-labs/repo-template#115` keeps pointing at the template's issue, and the new repository cites its own issues the same way. Test titles and messages are strings and are left as they are.

## Using it

1. `gh repo create <name> --public --template shyden-labs/repo-template`. A repo carrying game, art or learning content adds its own content licence.
2. Create `develop` and make it the default branch before Dependabot first runs. CI fails until this is done.
3. Set up SonarCloud as `docs/sonarcloud.md` describes (CI fails until `SONAR_TOKEN` is set). Then, as the operator, set the branch rules: `node scripts/branch-rules-setup.ts <owner/repo> build-and-test coverage "sonarcloud / sonarcloud"`, and add any check the project adds later.
4. Add the ecosystems your repo uses to `.github/dependabot.yml`, and enable Dependabot alerts and security updates.
5. `npm ci && npm run test:unit`.
6. Set up the project board as `docs/project-board.md` describes.
7. The template's dev-deploy stub was removed: this package hosts nothing, so there is no dev environment to deploy to (shyden-labs/playwright-devices#9).
8. Turn on SonarCloud as `docs/sonarcloud.md` describes.
