import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;
const CACHED_CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`;

export const COMMENTS_PATH = '/tmp/dv-e2e-comments.json';

const launchOptions = existsSync(CACHED_CHROME) ? { executablePath: CACHED_CHROME } : {};

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
