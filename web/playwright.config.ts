import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = 8799;
const BROWSERS = `${process.env.HOME}/.cache/ms-playwright`;

export const COMMENTS_PATH = '/tmp/dv-e2e-comments.json';

/**
 * The suite reviews a generated repository rather than dv's own last commit, so
 * the diff under the tests is the same on every run. `e2e/fixture.sh` builds it;
 * see the header there for what the diff is shaped to cover.
 */
const FIXTURE_REPO = '/tmp/dv-e2e-repo';

const BINARY = `${HERE}/../bin/dv`;

/**
 * Reuse whichever chromium the local playwright cache already holds instead of
 * pinning a build number that goes stale the next time browsers are installed.
 */
const cachedChrome = (): string | undefined => {
  if (!existsSync(BROWSERS)) return undefined;
  for (const entry of readdirSync(BROWSERS).sort().reverse()) {
    if (!entry.startsWith('chromium-')) continue;
    const binary = `${BROWSERS}/${entry}/chrome-linux64/chrome`;
    if (existsSync(binary)) return binary;
  }
  return undefined;
};

const executablePath = cachedChrome();
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // `github` annotates the failing lines but writes nothing to disk; pair it
  // with `html` so a red run leaves behind a report worth uploading.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions,
    // A browser test that only fails on a CI runner is unfixable from the log
    // alone. Keep the trace and the last frame.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // The fixture is rebuilt here rather than in globalSetup because dv is
    // spawned with the repo as its cwd, and Playwright needs that directory to
    // exist before it spawns anything.
    command:
      `bash ${HERE}/e2e/fixture.sh ${FIXTURE_REPO} && cd ${FIXTURE_REPO} && ` +
      `exec ${BINARY} --no-open --host 127.0.0.1 --port ${PORT} --idle-timeout 0 --comments ${COMMENTS_PATH} HEAD~1`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { DV_TOKEN: 'e2e-token' },
  },
});
