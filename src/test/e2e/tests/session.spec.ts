import { test, expect } from '@playwright/test';
import { CONSOLE_HOST, KEYCLOAK_HOST, signIn, shot } from './helpers';

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;

test('tokens never reach page JavaScript or browser storage; cookies are HttpOnly and SameSite=Strict', async ({ page, context }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await signIn(page, 'otto');
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  const exposed = await page.evaluate(() => ({
    cookie: document.cookie,
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    indexedDb: typeof indexedDB !== 'undefined' ? 'present' : 'absent',
  }));
  expect(exposed.cookie).not.toMatch(JWT);
  expect(exposed.cookie).not.toContain('q_session');
  expect(exposed.local).toBe('{}');
  expect(exposed.session).toBe('{}');
  const body = await page.content();
  expect(body).not.toMatch(JWT);
  const me = await page.evaluate(async () => (await fetch('/api/v1/me')).text());
  expect(me).not.toMatch(JWT);
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith('q_session'));
  expect(cookies.length).toBeGreaterThan(0);
  for (const c of cookies) {
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
  }
  // Only the console's own origin and Keycloak are contacted.
  expect([...hosts].sort()).toEqual([CONSOLE_HOST, KEYCLOAK_HOST].sort());
});

test('logout ends the session', async ({ page }) => {
  await signIn(page, 'vera');
  await page.getByRole('link', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signed-out\.html(\?.*)?$/);
  await expect(page.getByRole('heading', { name: /signed out/ })).toBeVisible();
  await shot(page, '09-signed-out');
  const r = await page.request.get('/api/v1/me');
  expect(r.status()).toBe(401);
  expect((await r.json()).code).toBe('SESSION_REQUIRED');
});

test('anonymous API calls get 401 and do not redirect', async ({ request }) => {
  for (const path of ['/api/v1/me', '/api/v1/overview', '/api/v1/orders', '/api/v1/orders/ord_x/summary', '/api/v1/incidents',
    '/api/v1/incidents/inc_ord_x/evidence', '/api/v1/sites', '/api/v1/delivery', '/api/v1/scenarios']) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).toBe(401);
  }
  const post = await request.post('/api/v1/orders', { maxRedirects: 0, headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'x' }, data: {} });
  expect(post.status()).toBe(401);
});
