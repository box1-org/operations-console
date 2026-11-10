import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, stub, shot } from './helpers';

// Edge site status and the Sites map (box1-docs#130). asset-service is stubbed: ok serves alerts and site status,
// nosites serves alerts but answers 404 for site status (an asset-service from before it), down drops the connection.

/**
 * The console caches asset-service's refusal of unsigned reads for a minute (review OPS-6), and the earlier specs leave
 * one behind; wait until the console reads the stub's new answer.
 */
async function untilSiteStatus(page: Page, siteStatus: string, alerts = 'OK') {
  await expect.poll(async () => {
    const body = await (await page.request.get('/api/v1/sites')).json();
    const asset = body.sources.find((s: { source: string }) => s.source === 'asset-service');
    return `${body.siteStatusSource.status} ${asset?.status}`;
  }, { timeout: 75_000, intervals: [2000] }).toBe(`${siteStatus} ${alerts}`);
}

test.afterAll(async ({ request }) => {
  await stub(request, { source: 'asset', mode: 'refuse' });
});

test('sites map and status table: state by label and shape, keyboard reachable, accessible in light and dark, no CSP violations',
  async ({ page, request }) => {
    test.setTimeout(150_000);
    const csp: string[] = [];
    page.on('console', (m) => { if (/Content-Security-Policy|Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    page.on('pageerror', (e) => csp.push('pageerror: ' + e.message));
    await stub(request, { source: 'asset', mode: 'ok' });
    await signIn(page, 'otto');
    await untilSiteStatus(page, 'OK');
    await page.goto('/sites');

    // Map: each placed site is a named link; the names carry the state in words.
    const map = page.getByTestId('site-map');
    await expect(map.getByRole('link', { name: /^site_ds9 Online, West \(site-west\), last seen 6 s ago, 0 active alerts$/ })).toBeVisible();
    await expect(map.getByRole('link', { name: /^site_spacedock Degraded, East \(site-east\), .*1 active alert$/ })).toBeVisible();
    await expect(map.getByRole('link', { name: /^site_utopia_planitia Offline, North, last seen 7 min ago/ })).toBeVisible();
    await expect(map.locator('[data-site="site_ds9"]')).toHaveAttribute('data-site-state', 'ONLINE');
    // Inventory-only sites have no place configured and never reported: listed beside the map, not hidden.
    await expect(page.getByTestId('unplaced-sites')).toContainText('site_east (no status reported)');
    await expect(page.getByTestId('unplaced-sites')).toContainText('site_west (no status reported)');

    // Table: state label, reasons, last seen, buffer, shortened digest with the full one on request, greenboot, alerts.
    const table = page.getByTestId('site-status-table');
    const ds9 = table.locator('tr[data-site="site_ds9"]');
    await expect(ds9).toContainText('Online');
    await expect(ds9).toContainText('6 s ago');
    await expect(ds9).toContainText('3 rows');
    await expect(ds9).toContainText('Green (healthy)');
    await expect(ds9.locator('summary')).toContainText('sha256:a11d6786b9a8…');
    await ds9.locator('summary').click();
    await expect(ds9.locator('.digest-full')).toHaveText('sha256:a11d6786b9a86378148ae55194acfd1cfb2d150ad298334fe00798d026abe3fe');
    const spacedock = table.locator('tr[data-site="site_spacedock"]');
    await expect(spacedock).toContainText('Degraded');
    await expect(spacedock).toContainText('Buffer depth at or over the threshold');
    await expect(spacedock).toContainText('240 rows');
    await expect(spacedock).toContainText('site events 4');
    await expect(spacedock.locator('td').last()).toHaveText('1');
    const utopia = table.locator('tr[data-site="site_utopia_planitia"]');
    await expect(utopia).toContainText('Offline');
    await expect(utopia).toContainText('No heartbeat within the offline window');
    await expect(utopia).toContainText('unknown'); // booted digest not reported
    await expect(table.locator('tr[data-site="site_east"]')).toContainText('No status reported');
    // Existing content stays: alerts and per-site stock.
    await expect(page.getByRole('table', { name: 'Active equipment alerts, newest first' })).toContainText('asset_pump_7');
    await expect(page.getByRole('heading', { name: 'site_east' })).toBeVisible();

    // Keyboard: Tab reaches the first map marker; Enter moves focus to that site's row.
    await page.locator('main h1').click();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.getAttribute('data-site') === 'site_ds9'
        && document.activeElement?.closest('[data-testid="site-map"]') !== null);
    }
    expect(reached, 'Tab reaches the site_ds9 map marker').toBe(true);
    await page.keyboard.press('Enter');
    await expect(ds9).toBeFocused();

    const failures: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/sites');
      await page.waitForLoadState('networkidle');
      await expect(map.getByRole('link').first()).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of result.violations) failures.push(`${scheme}: ${v.id} (${v.nodes.length}) ${v.help}`);
      await shot(page, `12-sites-map-${scheme}`);
    }
    // Phone width: the map scales down and the table scrolls inside its region; the page itself does not scroll sideways.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sites');
    await expect(map.getByRole('link').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const mobile = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of mobile.violations) failures.push(`mobile: ${v.id} (${v.nodes.length}) ${v.help}`);
    await shot(page, '14-sites-map-mobile');
    expect(failures).toEqual([]);
    expect(csp).toEqual([]);
  });

test('an asset-service without site status (404) or down still shows the inventory sites, with status unavailable',
  async ({ page, request }) => {
    test.setTimeout(150_000);
    await stub(request, { source: 'asset', mode: 'nosites' });
    await signIn(page, 'otto');
    await untilSiteStatus(page, 'UNAVAILABLE');
    await page.goto('/sites');
    await expect(page.getByTestId('site-status-source')).toContainText('Site status unavailable');
    await expect(page.getByTestId('site-status-source')).toContainText('HTTP 404');
    const table = page.getByTestId('site-status-table');
    await expect(table.locator('tr[data-site="site_east"]')).toContainText('Status unavailable');
    // Alerts still read: the alert's site is listed with its count.
    await expect(table.locator('tr[data-site="site_spacedock"] td').last()).toHaveText('1');
    await expect(page.getByRole('heading', { name: 'site_west' })).toBeVisible();
    await shot(page, '13-sites-status-unavailable');

    await stub(request, { source: 'asset', mode: 'down' });
    await page.goto('/sites');
    await expect(page.getByTestId('sources-banner').locator('[data-source="asset-service"]')).toContainText('unavailable');
    await expect(page.getByTestId('site-status-source')).toContainText('Site status unavailable');
    await expect(table.locator('tr[data-site="site_east"]')).toContainText('Status unavailable');
    await expect(table.locator('tr[data-site="site_east"] td').last()).toHaveText('unknown');
    await expect(page.getByRole('heading', { name: 'site_east' })).toBeVisible();
  });
