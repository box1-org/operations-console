import { defineConfig, devices } from '@playwright/test';

// Firefox only: Chrome and its extension are not used for box1 browser testing.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.CONSOLE_URL || 'http://localhost:18080', trace: 'off' },
  // accessibility.tabfocus=7: Tab reaches links as well as form controls, as for a keyboard user with full keyboard
  // access enabled (macOS Firefox's default reaches only form controls).
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'accessibility.tabfocus': 7 } } } }],
});
