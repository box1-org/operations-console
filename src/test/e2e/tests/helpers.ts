import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

export const STUBS = process.env.STUBS_URL || 'http://127.0.0.1:18081';
export const KEYCLOAK_HOST = new URL(process.env.KEYCLOAK_URL || 'http://localhost:18280').host;
export const CONSOLE_HOST = new URL(process.env.CONSOLE_URL || 'http://localhost:18080').host;
const RUN_DIR = process.env.RUN_DIR || '';
export const SHOTS = process.env.SHOTS_DIR || `${RUN_DIR}/screens`;
mkdirSync(SHOTS, { recursive: true });

function password(): string {
  return readFileSync(`${RUN_DIR}/user-password`, 'utf8').trim();
}

/** Sign in through the real Keycloak login form (code flow + PKCE), as a person would. */
export async function signIn(page: Page, user: string, path = '/') {
  await page.goto(path);
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(password());
  await page.locator('#kc-login').click();
  await page.waitForURL((u) => u.host === CONSOLE_HOST);
  await expect(page.locator('.topbar .user')).toContainText(user);
}

/** A react-aria Select's trigger: its accessible name is "<value> <label>" (the label is a span, not a <label>). */
export function selectButton(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`\\b${label}$`) });
}

/** Choose an option in a react-aria Select identified by its visible label (Customer, Site, SKU). */
export async function choose(page: Page, label: string, option: string | RegExp) {
  await selectButton(page, label).click();
  await page.getByRole('option', { name: option }).click();
}

export async function stub(request: APIRequestContext, body: object) {
  const r = await request.post(`${STUBS}/__control`, { data: body });
  expect(r.ok()).toBeTruthy();
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
