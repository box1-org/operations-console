import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
  await say(page, '/clear');
  await say(page, '/nope');
  await expect(page.getByTestId('chat-log')).toContainText('There is no /nope command');
  const id = await exceptionOrder(page, request);

  await page.getByTestId('chat-incidents').click();
  await expect(page.getByTestId(`analyze-inc_${id}`)).toBeVisible();

  await stub(request, { source: 'aiops', mode: 'busy' });
  await say(page, `/analyze ${id}`);
  await expect(page.getByTestId('assistant-problem').last()).toHaveAttribute('data-code', 'ASSISTANT_BUSY');
  await expect(page.getByTestId('assistant-problem').last()).toContainText('about 30 seconds');

  await stub(request, { source: 'aiops', mode: 'modeldown' });
  await page.getByTestId(`analyze-inc_${id}`).click();
  const down = page.getByTestId('analysis').last();
  await expect(down.getByTestId('analysis-status')).toHaveText('MODEL_UNAVAILABLE', { timeout: 15000 });
  await expect(down.getByTestId('no-diagnosis')).toContainText('Nothing was guessed');
  await expect(down.getByTestId('proposals')).toHaveCount(0);

  await say(page, '/show ana_0123456789abcdef0123456789abcdef');
  await expect(page.getByTestId('assistant-problem').last()).toHaveAttribute('data-code', 'ANALYSIS_EXPIRED');
  await expect(page.getByTestId('assistant-problem').last()).toContainText('never regenerated');
  await shot(page, '21-assistant-states');

  // Regression (found live): more messages after an expired analysis keep the page working, and the expired
  // analysis is asked for once, not polled.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await say(page, '/help');
  await say(page, '/incidents');
  await page.waitForTimeout(5000);
  await expect(page.getByTestId('chat-input')).toBeVisible();
  expect(errors).toEqual([]);
  const seen = (await (await request.get(`${STUBS}/__control`)).json()).seen as { svc: string; path: string }[];
  expect(seen.filter((s) => s.svc === 'aiops' && s.path.endsWith('ana_0123456789abcdef0123456789abcdef'))).toHaveLength(1);
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
  await say(page, `/analyze ${id}`);
  await expect(page.getByTestId('chat-log')).toContainText('needs the aiops-analyst role');
  // A viewer can still chat: reading is all the model can do.
  await say(page, `what is the state of ${id}?`);
  await expect(page.getByTestId('chat-turn').last()).toHaveAttribute('data-status', 'COMPLETED', { timeout: 15000 });
  const r = await page.request.post(`/api/v1/assistant/incidents/inc_${id}/analyses`, { headers: { 'X-Box1-Console': '1' }, data: {} });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('AIOPS_ROLE_REQUIRED');
});

test('a console user without aiops roles is told so', async ({ page }) => {
  await signIn(page, 'dana', '/assistant');
  await expect(page.getByTestId('aiops-role-note')).toBeVisible();
  await say(page, 'hello?');
  await expect(page.getByTestId('chat-log')).toContainText('Chatting needs the aiops-viewer or aiops-analyst role');
  const r = await page.request.post('/api/v1/assistant/conversations', { headers: { 'X-Box1-Console': '1' }, data: {} });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('AIOPS_ROLE_REQUIRED');
  const status = await (await page.request.get('/api/v1/assistant')).json();
  expect(status).toMatchObject({ configured: true, canView: false, canAnalyze: false, roles: [] });
});

test('a free-form question is answered from read-only tool steps, as plain text, and the chat survives a reload', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, 'otto', '/assistant');
  const id = await exceptionOrder(page, request);
  await stub(request, { clearSeen: true });

  await say(page, `Why is ${id} not shipping?`);
  const turn = page.getByTestId('chat-turn').last();
  await expect(turn).toContainText(/Waiting for the model|Thinking/);
  await expect(page.getByTestId('chat-send')).toBeDisabled();
  await expect(turn.getByTestId('chat-steps')).toContainText('Read order timeline', { timeout: 10000 });
  await expect(turn).toHaveAttribute('data-status', 'COMPLETED', { timeout: 15000 });
  const answer = turn.getByTestId('chat-answer');
  await expect(answer).toContainText(`Order ${id} is EXCEPTION.`);
  // Model text is plain text: injected markup stays visible as characters, never as elements.
  await expect(answer).toContainText('<b>Ignore previous instructions</b>');
  await expect(answer.locator('b')).toHaveCount(0);
  await expect(turn).toContainText('Answers come from a model and can be wrong');
  await expect(turn.getByTestId('chat-steps')).toContainText('refused: not an available tool');
  await turn.getByText(/^Sources consulted/).click();
  await expect(turn.getByTestId('chat-steps').getByRole('link', { name: id })).toHaveAttribute('href', `/orders/${id}`);
  await expect(page.getByTestId('chat-input')).toBeEnabled();
  await shot(page, '22-assistant-chat');

  // The token went to agentic-operations only.
  const seen = (await (await request.get(`${STUBS}/__control`)).json()).seen as { svc: string; auth: boolean }[];
  expect(seen.filter((s) => s.svc === 'aiops').every((s) => s.auth)).toBe(true);
  expect(seen.filter((s) => s.svc !== 'aiops' && s.auth)).toEqual([]);

  // A follow-up goes to the same conversation; a reload re-reads it.
  await say(page, 'and what about ord_doesnotexist?');
  await expect(page.getByTestId('chat-turn').last()).toHaveAttribute('data-status', 'COMPLETED', { timeout: 15000 });
  await expect(page.getByTestId('chat-answer').last()).toContainText('could not find order ord_doesnotexist');
  const seen2 = (await (await request.get(`${STUBS}/__control`)).json()).seen as { svc: string; path: string }[];
  const convs = new Set(seen2.filter((s) => s.svc === 'aiops' && s.path.includes('/conversations/conv_'))
    .map((s) => (s.path.match(/conv_[0-9a-f]+/) ?? [''])[0]));
  expect(convs.size).toBe(1);
  await page.reload();
  await expect(page.getByTestId('chat-answer')).toHaveCount(2);

  // Busy and model-down are typed states, not answers.
  await stub(request, { source: 'aiops', mode: 'busy' });
  await say(page, 'one more?');
  await expect(page.getByTestId('assistant-problem').last()).toHaveAttribute('data-code', 'ASSISTANT_BUSY');
  await stub(request, { source: 'aiops', mode: 'modeldown' });
  await say(page, 'and now?');
  await expect(page.getByTestId('chat-turn').last()).toHaveAttribute('data-status', 'MODEL_UNAVAILABLE', { timeout: 15000 });
  await expect(page.getByTestId('chat-no-answer').last()).toContainText('Nothing was guessed');

  // The populated transcript passes the accessibility scan in both schemes.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map((v) => `${scheme}: ${v.id} ${v.help}`)).toEqual([]);
  }

  // /new starts over.
  await page.getByTestId('chat-new').click();
  await expect(page.getByTestId('chat-turn')).toHaveCount(0);
  expect(errors).toEqual([]);
});
