// Playwright configuration for the DataLab Sandbox "definition of done" harness.
// Run from the repo root:  npx playwright test --config tests/playwright.config.js
import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Artifacts go to the OS temp dir: synced folders (OneDrive, Dropbox) lock trace files mid-write (EBUSY).
const ARTIFACTS = process.env.CI ? '..' : path.join(os.tmpdir(), 'datalab-sandbox-tests');

const PORT = process.env.PORT || 8777;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js/,
  timeout: 15 * 60 * 1000,          // one test iterates over a whole track (pandas loads Pyodide once)
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(ARTIFACTS, 'playwright-report') }]],
  outputDir: path.join(ARTIFACTS, 'test-results'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    headless: true,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python -m http.server ${PORT} --bind 127.0.0.1`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 30 * 1000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
