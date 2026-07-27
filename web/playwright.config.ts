import { existsSync, readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;
const BROWSERS = `${process.env.HOME}/.cache/ms-playwright`;

export const COMMENTS_PATH = '/tmp/dv-e2e-comments.json';

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
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions,
  },
  webServer: {
    command: `./bin/dv --no-open --host 127.0.0.1 --port ${PORT} --idle-timeout 0 --comments ${COMMENTS_PATH} HEAD~1`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { DV_TOKEN: 'e2e-token' },
  },
});
