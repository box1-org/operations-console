import { test, expect, type Page } from '@playwright/test';
import { choose, signIn, stub, shot, STUBS } from './helpers';

async function placeOrder(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Place order' }).first().click();
  await choose(page, 'Site', /^site_east/);
  await choose(page, 'SKU', /^SKU-42:/);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Submit order' }).click();
  await expect(page.getByTestId('placed')).toBeVisible();
  const id = (await page.getByTestId('placed').getByRole('link').textContent())!.trim();
  expect(id).toMatch(/^ord_/);
  return id;
}

async function erp(page: Page, stage: string, label: string) {
  const panel = page.getByTestId('erp-panel');
  await expect(panel.locator(`[data-erp-stage="${stage}"]`)).toHaveText(label, { timeout: 15_000 });
}

test.beforeEach(async ({ request }) => {
  for (const source of ['order', 'inventory', 'fulfillment']) await stub(request, { source, mode: 'ok' });
});

test('seed order, submit, follow the timeline through a held ERP request to completion', async ({ page, request }) => {
  await signIn(page, 'otto');
  await shot(page, '01-home');
  const id = await placeOrder(page);
  await shot(page, '02-placed');
  await page.getByRole('link', { name: 'Follow this order' }).click();
  await expect(page.locator('[data-state="SUBMITTED"]')).toBeVisible();

  await stub(request, { advance: { orderId: id, to: 'RESERVED', reasonCode: 'INVENTORY_RESERVED', eventType: 'inventory.reserved.v1' } });
  await stub(request, { advance: { orderId: id, to: 'FULFILLMENT_REQUESTED', reasonCode: 'FULFILLMENT_REQUESTED', eventType: 'fulfillment.requested.v1' } });
  await stub(request, { fulfillment: { orderId: id, dispatch: 'QUEUED', erpAcknowledgement: 'NONE', outcome: 'AWAITING_ERP', uploads: 0 } });
  await expect(page.getByTestId('awaiting-erp')).toContainText('Awaiting ERP acknowledgement', { timeout: 15_000 });
  await erp(page, 'QUEUED', 'Queued for the ERP');

  await stub(request, { fulfillment: { orderId: id, dispatch: 'UPLOADED', erpAcknowledgement: 'NONE', outcome: 'AWAITING_ERP', uploads: 1 } });
  await erp(page, 'UPLOADED_AWAITING_ACK', 'Uploaded, awaiting ERP acknowledgement');
  await expect(page.getByTestId('awaiting-erp')).toContainText('Outstanding attempts: 1 upload(s)');
  // Diagnosis links: trace and correlation IDs, and the deployed source revision.
  await expect(page.getByTestId('timeline')).toContainText('fulfillment.requested.v1');
  await expect(page.getByTestId('evidence').locator('[data-kind="source-revision"] a')).toHaveAttribute('href', /github\.com\/box1-org\/order-service\/commit\//);
  await expect(page.getByTestId('evidence').locator('[data-kind="trace"] a'))
    .toHaveAttribute('href', /^https:\/\/console-openshift-console\.apps\.ocp\.box1\.org\/observe\/traces\/[0-9a-f]{32}\?namespace=box1-observability&name=box1&tenant=dev$/);
  await shot(page, '03-awaiting-erp');

  await stub(request, { fulfillment: { orderId: id, dispatch: 'UPLOADED', erpAcknowledgement: 'ACKNOWLEDGED', outcome: 'PENDING' } });
  await erp(page, 'ACCEPTED', 'Accepted by the ERP');

  await stub(request, { fulfillment: { orderId: id, dispatch: 'UPLOADED', erpAcknowledgement: 'ACKNOWLEDGED', outcome: 'HELD' } });
  await erp(page, 'HELD', 'Held by an ERP operator');
  await expect(page.getByTestId('erp-panel')).toContainText('Waiting, not a failure');
  await expect(page.getByTestId('erp-panel').locator('.tone-failure')).toHaveCount(0);
  await shot(page, '04-held');

  // Recover: the ERP operator releases the hold, the ERP ships, the order service records it.
  await stub(request, { fulfillment: { orderId: id, dispatch: 'UPLOADED', erpAcknowledgement: 'ACKNOWLEDGED', outcome: 'PENDING' } });
  await erp(page, 'ACCEPTED', 'Accepted by the ERP');
  await stub(request, { fulfillment: { orderId: id, dispatch: 'UPLOADED', erpAcknowledgement: 'ACKNOWLEDGED', outcome: 'SHIPPED', shipmentId: 'shp_demo_1' } });
  await erp(page, 'SHIPPED', 'Shipped');
  await expect(page.locator('[data-state="FULFILLMENT_REQUESTED"]')).toBeVisible();
  await stub(request, { advance: { orderId: id, to: 'SHIPPED', reasonCode: 'SHIPMENT_CONFIRMED', eventType: 'shipment.confirmed.v1' } });
  await stub(request, { advance: { orderId: id, to: 'COMPLETED', reasonCode: 'COMPLETED', eventType: 'order.state-changed.v1' } });
  await expect(page.locator('[data-state="COMPLETED"]')).toHaveText('Completed', { timeout: 15_000 });
  await expect(page.getByText('final state')).toBeVisible();
  await expect(page.getByTestId('timeline').locator('li')).toHaveCount(5);
  await shot(page, '05-completed');
});

test('an unconfirmed submission retried through the UI, even after leaving the page, creates one order', async ({ page, request }) => {
  const customer = 'cust_demo_lin_' + Date.now();
  await signIn(page, 'otto', '/orders/new');
  await choose(page, 'Customer', 'Other…');
  await page.getByLabel('Customer ID').fill(customer);
  await choose(page, 'Site', /^site_east/);
  await choose(page, 'SKU', /^SKU-7:/);
  const key = await page.getByTestId('idempotency-key').textContent();
  // The order service is slow: the console times out, but the order service still creates the order afterwards.
  await stub(request, { source: 'order', mode: 'slow' });
  await page.getByRole('button', { name: 'Submit order' }).click();
  await expect(page.getByTestId('unconfirmed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /\bSKU$/ })).toBeDisabled();
  await expect(page.getByLabel('Customer ID')).toHaveAttribute('readonly', '');
  await stub(request, { source: 'order', mode: 'ok' });
  await page.waitForTimeout(6500); // let the slow create complete upstream
  // Leaving and returning keeps the same key and values.
  await page.goto('/orders');
  await page.goto('/orders/new');
  await expect(page.getByTestId('idempotency-key')).toHaveText(key!);
  await page.getByRole('button', { name: 'Submit the same order again' }).click();
  await expect(page.getByTestId('placed')).toContainText('Already placed');
  await expect(page.getByTestId('placed')).toBeFocused();
  const list = await page.request.get('/api/v1/orders?sku=SKU-7');
  expect((await list.json()).items.filter((o: { customerId: string }) => o.customerId === customer)).toHaveLength(1);
  const seen = await (await request.get(`${STUBS}/__control`)).json();
  expect(seen.seen.filter((s: { method: string; path: string }) => s.method === 'POST' && s.path === '/api/v1/orders').length).toBeGreaterThanOrEqual(2);
  // A finished order clears the pending key: the next form has a fresh one.
  await page.getByRole('button', { name: 'Place another order' }).click();
  await expect(page.getByTestId('idempotency-key')).not.toHaveText(key!);
});

test('adapter unreachable shows ERP detail unavailable with the order service state', async ({ page, request }) => {
  await signIn(page, 'otto');
  const id = await placeOrder(page);
  await stub(request, { advance: { orderId: id, to: 'RESERVED', reasonCode: 'INVENTORY_RESERVED', eventType: 'inventory.reserved.v1' } });
  await stub(request, { advance: { orderId: id, to: 'FULFILLMENT_REQUESTED', reasonCode: 'FULFILLMENT_REQUESTED', eventType: 'fulfillment.requested.v1' } });
  await stub(request, { source: 'fulfillment', mode: 'down' });
  await page.goto(`/orders/${id}`);
  await erp(page, 'UNAVAILABLE', 'ERP detail unavailable');
  await expect(page.locator('[data-state="FULFILLMENT_REQUESTED"]')).toHaveText('Awaiting ERP acknowledgement');
  await expect(page.getByTestId('sources-banner').locator('[data-source="fulfillment-adapter"]')).toContainText('Fulfillment adapter — unavailable');
  await shot(page, '06-erp-unavailable');
});

test('each upstream slow or down in turn gives a partial page naming the failed source', async ({ page, request }) => {
  await signIn(page, 'otto');
  const id = await placeOrder(page);
  await stub(request, { advance: { orderId: id, to: 'RESERVED', reasonCode: 'INVENTORY_RESERVED', eventType: 'inventory.reserved.v1' } });
  await stub(request, { advance: { orderId: id, to: 'FULFILLMENT_REQUESTED', reasonCode: 'FULFILLMENT_REQUESTED', eventType: 'fulfillment.requested.v1' } });
  await stub(request, { fulfillment: { orderId: id, dispatch: 'UPLOADED', erpAcknowledgement: 'ACKNOWLEDGED', outcome: 'PENDING' } });

  // Inventory slow: order detail still renders within the budget, reservation detail named unavailable.
  await stub(request, { source: 'inventory', mode: 'slow' });
  let start = Date.now();
  await page.goto(`/orders/${id}`);
  await expect(page.getByTestId('sources-banner').locator('[data-source="inventory-service"]')).toBeVisible({ timeout: 8000 });
  expect(Date.now() - start).toBeLessThan(8000);
  await expect(page.getByTestId('erp-panel').locator('[data-erp-stage="ACCEPTED"]')).toBeVisible();
  await stub(request, { source: 'inventory', mode: 'ok' });

  // Fulfillment adapter slow: ERP detail unavailable, never a guessed stage.
  await stub(request, { source: 'fulfillment', mode: 'slow' });
  start = Date.now();
  await page.goto(`/orders/${id}`);
  await erp(page, 'UNAVAILABLE', 'ERP detail unavailable');
  expect(Date.now() - start).toBeLessThan(8000);
  await stub(request, { source: 'fulfillment', mode: 'ok' });

  // Order service down: list and overview are partial with the source named; detail is a typed error naming it.
  await stub(request, { source: 'order', mode: 'down' });
  await page.goto('/orders');
  await expect(page.getByTestId('sources-banner').locator('[data-source="order-service"]')).toContainText('Order service — unavailable');
  await page.goto(`/orders/${id}`);
  await expect(page.getByRole('alert')).toContainText('order-service');
  await stub(request, { source: 'order', mode: 'slow' });
  start = Date.now();
  await page.goto('/');
  await expect(page.getByTestId('sources-banner').locator('[data-source="order-service"]')).toBeVisible({ timeout: 8000 });
  expect(Date.now() - start).toBeLessThan(8000);
  await stub(request, { source: 'order', mode: 'ok' });

  // Asset service refuses console tokens (gap G-2): named, not hidden.
  await page.goto('/sites');
  await expect(page.getByTestId('sources-banner').locator('[data-source="asset-service"]')).toContainText('refused the console');
  await expect(page.getByRole('heading', { name: 'site_east' })).toBeVisible();
  await shot(page, '06-sites-partial');
});

test('place order: site and SKU come from inventory; the SKU list follows the site; over-available warns but submits', async ({ page }) => {
  await signIn(page, 'otto', '/orders/new');
  // Sites from the inventory service, not typed.
  await page.getByRole('button', { name: /\bSite$/ }).click();
  await expect(page.getByRole('option')).toHaveText([/^site_east \(2 SKUs\)/, /^site_west \(1 SKU\)/]);
  await page.keyboard.press('Escape');
  const skuButton = page.getByRole('button', { name: /\bSKU$/ });
  await expect(skuButton).toBeDisabled();
  await choose(page, 'Site', /^site_west/);
  await skuButton.click();
  await expect(page.getByRole('option')).toHaveText([/^SKU-42: 4 available \(5 on hand, 1 reserved\)/]);
  await page.getByRole('option', { name: /^SKU-42:/ }).click();
  await expect(page.getByText('4 available at site_west')).toBeVisible();
  // Changing the site clears the SKU.
  await choose(page, 'Site', /^site_east/);
  await expect(skuButton).toContainText('Choose a SKU');
  await expect(page.getByRole('button', { name: 'Submit order' })).toBeDisabled();
  await choose(page, 'SKU', /^SKU-7:/);
  await page.getByLabel('Quantity').fill('20');
  await expect(page.getByTestId('over-available')).toContainText('More than the 12 available');
  await shot(page, '02a-place-order-dropdowns');
  await page.getByRole('button', { name: 'Submit order' }).click();
  await expect(page.getByTestId('placed')).toContainText('Order accepted');
});

test('place order: with inventory down the page names it and falls back to typed site and SKU', async ({ page, request }) => {
  await stub(request, { source: 'inventory', mode: 'down' });
  await signIn(page, 'otto', '/orders/new');
  await expect(page.getByTestId('inventory-fallback')).toContainText('Inventory service');
  await expect(page.getByTestId('inventory-fallback')).toContainText('Type them instead');
  await page.getByLabel('Site').fill('site_east');
  await page.getByLabel('SKU').fill('SKU-42');
  await page.getByRole('button', { name: 'Submit order' }).click();
  await expect(page.getByTestId('placed')).toContainText('Order accepted');
  await stub(request, { source: 'inventory', mode: 'ok' });
});
