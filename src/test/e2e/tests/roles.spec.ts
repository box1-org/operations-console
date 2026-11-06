import { test, expect } from '@playwright/test';
import { signIn, shot } from './helpers';

const ORDER = { customerId: 'cust_demo_ada', sku: 'SKU-42', quantity: 1, siteId: 'site_east' };

test('a user without console roles sees forbidden states and the backend refuses every API', async ({ page }) => {
  await signIn(page, 'nora');
  await expect(page.locator('.topbar .roles')).toHaveText('no console role');
  await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link')).toHaveCount(0);
  await expect(page.getByTestId('forbidden')).toBeVisible();
  await shot(page, '08-forbidden-no-role');
  for (const path of ['/api/v1/overview', '/api/v1/orders', '/api/v1/orders/ord_x/summary', '/api/v1/incidents',
    '/api/v1/incidents/inc_ord_x/evidence', '/api/v1/sites', '/api/v1/delivery', '/api/v1/scenarios']) {
    const r = await page.request.get(path);
    expect(r.status(), path).toBe(403);
    expect((await r.json()).code).toBe('ROLE_REQUIRED');
  }
  const post = await page.request.post('/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'nora-1' }, data: ORDER });
  expect(post.status()).toBe(403);
  await page.goto('/delivery');
  await expect(page.getByTestId('forbidden')).toHaveCount(1);
});

test('a viewer cannot place orders even by calling the API directly', async ({ page }) => {
  await signIn(page, 'vera');
  await expect(page.getByRole('link', { name: 'Place order' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Delivery' })).toHaveCount(0);
  await page.goto('/orders/new');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  const r = await page.request.post('/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'viewer-1' }, data: ORDER });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('ROLE_REQUIRED');
  const d = await page.request.get('/api/v1/delivery');
  expect(d.status()).toBe(403);
});

test('a developer sees delivery revisions', async ({ page }) => {
  await signIn(page, 'dana');
  await page.getByRole('link', { name: 'Delivery' }).click();
  await expect(page.getByRole('cell', { name: 'order-service' })).toBeVisible();
  await expect(page.getByRole('link', { name: '0123456789ab' }).first()).toBeVisible();
  await shot(page, '07-delivery');
});

test('state-changing calls without the console header or from another origin are refused (CSRF)', async ({ page }) => {
  await signIn(page, 'otto');
  const noHeader = await page.request.post('/api/v1/orders', { headers: { 'Idempotency-Key': 'csrf-1' }, data: ORDER });
  expect(noHeader.status()).toBe(403);
  expect((await noHeader.json()).code).toBe('CONSOLE_HEADER_REQUIRED');
  const form = await page.request.post('/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'csrf-2' }, form: { customerId: 'cust_demo_ada' } });
  expect(form.status()).toBe(403);
  const foreign = await page.request.post('/api/v1/orders', {
    headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'csrf-3', Origin: 'https://evil.example' }, data: ORDER });
  expect(foreign.status()).toBe(403);
});
