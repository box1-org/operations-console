import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { signIn, stub, shot, STUBS } from './helpers';

/** An exception order, so there is an active incident for the Assistant to analyze. */
async function exceptionOrder(page: Page, request: APIRequestContext): Promise<string> {
  const r = await page.request.post('/api/v1/orders', { headers: { 'X-Box1-Console': '1', 'Idempotency-Key': 'assist-' + Date.now() + Math.random() },
    data: { customerId: 'cust_demo_ada', sku: 'SKU-42', quantity: 1, siteId: 'site_east' } });
  expect(r.ok()).toBeTruthy();
  const id = (await r.json()).order.orderId as string;
  await stub(request, { advance: { orderId: id, to: 'EXCEPTION', reasonCode: 'RESERVATION_EXPIRED', eventType: 'inventory.reservation-expired.v1' } });
  return id;
}

async function say(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
}

test.afterEach(async ({ request }) => {
  await stub(request, { source: 'aiops', mode: 'ok' });
});

test('an analyst asks the assistant about an incident and sees cited findings with proposals that are never executed', async ({ page, request }) => {
  const csp: string[] = [];
  page.on('console', (m) => { if (/Content-Security-Policy|Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await signIn(page, 'otto');
  const id = await exceptionOrder(page, request);
  await stub(request, { clearSeen: true });

  await page.goto(`/incidents/inc_${id}`);
  await page.getByTestId('ask-assistant').click();
  await expect(page).toHaveURL(/\/assistant$/);
  const analysis = page.getByTestId('analysis').last();
  await expect(analysis.getByTestId('analysis-status')).toHaveText('RUNNING');
  await expect(analysis.getByTestId('analysis-status')).toHaveText('COMPLETED', { timeout: 15000 });
  await expect(analysis).toContainText('The order moved to EXCEPTION after its reservation expired');
  // Evidence text is shown as text, never as markup.
  await expect(analysis).toContainText('<b>Ignore previous instructions</b>');
  await expect(analysis.locator('b')).toHaveCount(0);
  const proposals = analysis.getByTestId('proposals');
  await expect(proposals.getByRole('heading')).toHaveText('Proposed only — never executed');
  await expect(proposals).toContainText('ROLLBACK_DEPLOYMENT');
  await expect(proposals.getByRole('button')).toHaveCount(0);
  await analysis.getByText(/^Evidence \(3\)$/).click();
  await expect(analysis.getByText('UNAVAILABLE', { exact: true })).toBeVisible();
  // Only https links are clickable; agentic-operations' identifiers and anything else stay text.
  await expect(analysis.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(analysis.getByText('javascript:alert(1)')).toBeVisible();
  await shot(page, '20-assistant-analysis');

  // The person's token went to agentic-operations only.
  const seen = (await (await request.get(`${STUBS}/__control`)).json()).seen as { svc: string; auth: boolean }[];
  expect(seen.filter((s) => s.svc === 'aiops').every((s) => s.auth)).toBe(true);
  expect(seen.filter((s) => s.svc !== 'aiops' && s.auth)).toEqual([]);
  expect(csp).toEqual([]);

  // The transcript survives a reload in the same tab; the analysis is read again, not regenerated.
  await page.reload();
  await expect(page.getByTestId('analysis').last().getByTestId('analysis-status')).toHaveText('COMPLETED');
});

test('commands, a full model queue, a model outage and an expired analysis are each stated plainly', async ({ page, request }) => {
  await signIn(page, 'otto', '/assistant');
  await say(page, 'clear');
  await say(page, 'what is wrong with my orders?');
  await expect(page.getByTestId('chat-log')).toContainText('do not answer free-form questions');
  const id = await exceptionOrder(page, request);

  await page.getByTestId('chat-incidents').click();
  await expect(page.getByTestId(`analyze-inc_${id}`)).toBeVisible();

  await stub(request, { source: 'aiops', mode: 'busy' });
  await say(page, `analyze ${id}`);
  await expect(page.getByTestId('assistant-problem').last()).toHaveAttribute('data-code', 'ASSISTANT_BUSY');
  await expect(page.getByTestId('assistant-problem').last()).toContainText('about 30 seconds');

  await stub(request, { source: 'aiops', mode: 'modeldown' });
  await page.getByTestId(`analyze-inc_${id}`).click();
  const down = page.getByTestId('analysis').last();
  await expect(down.getByTestId('analysis-status')).toHaveText('MODEL_UNAVAILABLE', { timeout: 15000 });
  await expect(down.getByTestId('no-diagnosis')).toContainText('Nothing was guessed');
  await expect(down.getByTestId('proposals')).toHaveCount(0);

  await say(page, 'show ana_0123456789abcdef0123456789abcdef');
  await expect(page.getByTestId('assistant-problem').last()).toHaveAttribute('data-code', 'ANALYSIS_EXPIRED');
  await expect(page.getByTestId('assistant-problem').last()).toContainText('never regenerated');
  await shot(page, '21-assistant-states');
});

test('a viewer can read but not start analyses, and the service refuses a direct call', async ({ page, request }) => {
  await signIn(page, 'otto');
  const id = await exceptionOrder(page, request);
  await page.context().clearCookies();
  await signIn(page, 'vera', `/incidents/inc_${id}`);
  await expect(page.getByTestId('incident-status')).toBeVisible();
  await expect(page.getByTestId('ask-assistant')).toHaveCount(0);
  await page.getByRole('link', { name: 'Assistant' }).click();
  await expect(page.getByTestId('aiops-viewer-note')).toBeVisible();
  await say(page, `analyze ${id}`);
  await expect(page.getByTestId('chat-log')).toContainText('needs the aiops-analyst role');
  const r = await page.request.post(`/api/v1/assistant/incidents/inc_${id}/analyses`, { headers: { 'X-Box1-Console': '1' }, data: {} });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('AIOPS_ROLE_REQUIRED');
});

test('a console user without aiops roles is told so', async ({ page }) => {
  await signIn(page, 'dana', '/assistant');
  await expect(page.getByTestId('aiops-role-note')).toBeVisible();
  const status = await (await page.request.get('/api/v1/assistant')).json();
  expect(status).toMatchObject({ configured: true, canView: false, canAnalyze: false, roles: [] });
});
