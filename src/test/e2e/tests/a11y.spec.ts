import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, stub, shot } from './helpers';

test('automated accessibility scan (WCAG 2.1 A/AA) on every page and state', async ({ page, request }) => {
  await signIn(page, 'otto');
  // An exception order, so the incident pages have content.
  const r = await page.request.post('/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'a11y-' + Date.now() },
    data: { customerId: 'cust_demo_kai', sku: 'SKU-42', quantity: 1, siteId: 'site_west' } });
  const id = (await r.json()).order.orderId;
  await stub(request, { advance: { orderId: id, to: 'EXCEPTION', reasonCode: 'RESERVATION_EXPIRED', eventType: 'inventory.reservation-expired.v1' } });
  const failures: string[] = [];
  for (const path of ['/', '/orders', '/orders/new', `/orders/${id}`, '/incidents', `/incidents/inc_${id}`, '/sites', '/delivery', '/demo', '/nope']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of result.violations) failures.push(`${path}: ${v.id} (${v.nodes.length}) ${v.help}`);
    expect(result.passes.length, `axe ran on ${path}`).toBeGreaterThan(0);
  }
  expect(failures).toEqual([]);
});

test('keyboard-only traversal: order and incident', async ({ page, request }) => {
  await signIn(page, 'otto');
  const r = await page.request.post('/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'kbd-' + Date.now() },
    data: { customerId: 'cust_demo_kai', sku: 'SKU-42', quantity: 1, siteId: 'site_west' } });
  const id = (await r.json()).order.orderId;
  await stub(request, { advance: { orderId: id, to: 'EXCEPTION', reasonCode: 'RESERVATION_EXPIRED', eventType: 'inventory.reservation-expired.v1' } });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  // Orders: Tab to the nav link, Enter, Tab to the order link, Enter.
  async function tabTo(name: string | RegExp, limit = 40, key = 'Tab') {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press(key);
      const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');
      if (typeof name === 'string' ? focused === name : name.test(focused)) return;
    }
    throw new Error(`could not reach ${name} by keyboard`);
  }
  await tabTo('Orders');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  await tabTo(id);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(id);
  await expect(page.locator('main')).toBeFocused();
  // Incident: from the page, keyboard to Incidents, then the incident, then its evidence.
  // Back from the focused page content into the navigation.
  await tabTo('Incidents', 10, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();
  await tabTo(`inc_${id}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Incident evidence' })).toBeVisible();
  await expect(page.getByTestId('incident-status')).toContainText('Active');
  await shot(page, '10-incident-evidence');
});

test('mobile width (390 px): no horizontal overflow on any page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, 'otto');
  for (const path of ['/', '/orders', '/orders/new', '/incidents', '/sites', '/demo']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto('/orders');
  await shot(page, '11-mobile-orders');
  await context.close();
});
