import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync } from 'node:fs';

// Read-only acceptance against the real Route. Creates no orders, changes no state. The user and password come from
// the environment / a private file (LIVE_USER, $RUN_DIR/live-password) and never from this repository.
const BASE = process.env.CONSOLE_URL ?? 'https://operations-console-dev.apps.ocp.box1.org';
const KEYCLOAK = process.env.KEYCLOAK_HOST ?? 'keycloak.apps.ocp.box1.org';
const USER = process.env.LIVE_USER ?? '';
const SHOTS = process.env.SHOTS_DIR ?? `${process.env.RUN_DIR}/live-screens`;
mkdirSync(SHOTS, { recursive: true });
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;

async function signIn(page: Page, path = '/') {
  await page.goto(BASE + path);
  await page.locator('#username').fill(USER);
  await page.locator('#password').fill(readFileSync(`${process.env.RUN_DIR}/live-password`, 'utf8'));
  await page.locator('#kc-login').click();
  await page.waitForURL((u) => u.host === new URL(BASE).host && !u.pathname.startsWith('/callback'));
  await expect(page.locator('.topbar .user')).toContainText(USER);
}

test.describe.configure({ mode: 'serial' });

test('live: session, tokens, hosts, CSP, every page with axe (light and dark)', async ({ page, context }) => {
  const hosts = new Set<string>();
  const csp: string[] = [];
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  page.on('console', (m) => { if (/Content.Security.Policy/i.test(m.text())) csp.push(m.text()); });
  page.on('pageerror', (e) => csp.push('pageerror: ' + e.message));
  await signIn(page);
  // The bundle is served from the pod: the app rendered, and its script came from the Route.
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((s) => s.startsWith(new URL(BASE).origin + '/assets/'))).toBe(true);
  const assetResp = await page.request.get(scripts[0]);
  expect(assetResp.status()).toBe(200);
  expect(assetResp.headers()['cache-control']).toContain('immutable');

  const orders = await (await page.request.get(BASE + '/api/v1/orders?size=5')).json();
  const incidents = await (await page.request.get(BASE + '/api/v1/incidents')).json();
  const paths = ['/', '/orders', '/orders/new', '/incidents', '/sites', '/delivery', '/demo'];
  if (orders.items.length) paths.push(`/orders/${orders.items[0].orderId}`);
  if (incidents.items.length) paths.push(`/incidents/${incidents.items[0].incidentId}`);
  const failures: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of paths) {
      await page.goto(BASE + path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main h1')).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of r.violations) failures.push(`${scheme} ${path}: ${v.id} (${v.nodes.length})`);
      if (scheme === 'light') await page.screenshot({ path: `${SHOTS}/live${path.replace(/\//g, '_') || '_home'}.png`, fullPage: true });
    }
  }
  expect(failures).toEqual([]);
  expect(csp).toEqual([]);

  const exposed = await page.evaluate(() => ({ c: document.cookie, l: JSON.stringify({ ...localStorage }), s: JSON.stringify({ ...sessionStorage }), h: document.documentElement.outerHTML }));
  for (const v of Object.values(exposed)) expect(v).not.toMatch(JWT);
  expect(exposed.c).not.toContain('q_session');
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith('q_session'));
  expect(cookies.length).toBeGreaterThan(0);
  for (const c of cookies) { expect(c.httpOnly).toBe(true); expect(c.secure).toBe(true); expect(c.sameSite).toBe('Strict'); }
  expect([...hosts].sort()).toEqual([new URL(BASE).host, KEYCLOAK].sort());
  console.log('LIVE pages', paths.join(' '), '| orders seen', orders.items.length, 'window', JSON.stringify(orders.window), '| incidents', incidents.items.length);
});

test('live: upstream sources as the console sees them', async ({ page }) => {
  await signIn(page);
  for (const path of ['/api/v1/overview', '/api/v1/sites', '/api/v1/delivery', '/api/v1/scenarios']) {
    const body = await (await page.request.get(BASE + path)).json();
    console.log('LIVE sources', path, JSON.stringify(body.sources.map((s: { source: string; status: string; latencyMs: number | null }) => [s.source, s.status, s.latencyMs])));
  }
  const orders = await (await page.request.get(BASE + '/api/v1/orders?size=5')).json();
  if (orders.items.length) {
    const sum = await (await page.request.get(BASE + `/api/v1/orders/${orders.items[0].orderId}/summary`)).json();
    console.log('LIVE summary', sum.order.state, '| erp', sum.erp.stage, sum.erp.label, '| timeline', sum.timeline.length, '| sources', JSON.stringify(sum.sources.map((s: { source: string; status: string }) => [s.source, s.status])));
    const delivery = await (await page.request.get(BASE + '/api/v1/delivery')).json();
    console.log('LIVE delivery', JSON.stringify(delivery.services.map((s: { service: string; gitRef: string | null }) => [s.service, s.gitRef?.slice(0, 8)])));
  }
});

test('live: CSRF refusals never reach the order service', async ({ page }) => {
  await signIn(page);
  const order = { customerId: 'cust_demo_ada', sku: 'SKU-NEVER', quantity: 1, siteId: 'site_never' };
  const noHeader = await page.request.post(BASE + '/api/v1/orders', { headers: { 'Idempotency-Key': 'live-csrf-1' }, data: order });
  expect(noHeader.status()).toBe(403);
  expect((await noHeader.json()).code).toBe('CONSOLE_HEADER_REQUIRED');
  const form = await page.request.post(BASE + '/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'live-csrf-2' }, form: { customerId: 'cust_demo_ada' } });
  expect(form.status()).toBe(403);
  const sibling = await page.request.post(BASE + '/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'live-csrf-3', Origin: 'https://asset-service-dev.apps.ocp.box1.org' }, data: order });
  expect(sibling.status()).toBe(403);
});

test('live: keyboard traversal and mobile width', async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => (document.activeElement as HTMLElement)?.innerText?.trim())) === 'Orders') break;
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mobile.newPage();
  await signIn(m);
  for (const path of ['/', '/orders', '/incidents', '/sites', '/delivery']) {
    await m.goto(BASE + path);
    await m.waitForLoadState('networkidle');
    expect(await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
  await m.screenshot({ path: `${SHOTS}/live_mobile_orders.png`, fullPage: true });
  await mobile.close();
});

test('live: place order lists the inventory service\'s sites and SKUs (read-only, nothing submitted)', async ({ page }) => {
  await signIn(page, '/orders/new');
  const inventory = await (await page.request.get(BASE + '/api/v1/sites')).json();
  const expected = inventory.items.map((s: { siteId: string }) => s.siteId);
  expect(expected.length).toBeGreaterThan(0);
  const site = page.getByRole('button', { name: /\bSite$/ });
  await site.click();
  const shown = (await page.getByRole('option').allTextContents()).map((t) => t.split(' ')[0]);
  expect(shown).toEqual(expected);
  await page.getByRole('option').first().click();
  const sku = page.getByRole('button', { name: /\bSKU$/ });
  await sku.click();
  const skus = (await page.getByRole('option').allTextContents()).map((t) => t.split(':')[0]);
  expect(skus).toEqual(inventory.items[0].stock.map((s: { sku: string }) => s.sku));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/live_place_order.png`, fullPage: true });
  console.log('LIVE place-order sites', shown.join(','), '| first site SKUs', skus.join(','));
});

test('live: logout ends the session', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signed-out\.html(\?.*)?$/);
  expect((await page.request.get(BASE + '/api/v1/me')).status()).toBe(401);
  // The Keycloak SSO session must end too: a revisit shows the login form instead of signing straight back in.
  await page.goto(BASE + '/');
  await expect(page.locator('#kc-login')).toBeVisible();
});
