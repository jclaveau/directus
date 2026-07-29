import { expect, test } from '@playwright/test';

// Smoke-tests the fork's cache page in a real browser — the visual behaviour jsdom
// can't drive (chart legend layout, tooltip, the second latency chart). Boots
// against a seeded Directus that serves the admin at BASE_URL/admin.

const EMAIL = process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const PASSWORD = process.env['ADMIN_PASSWORD'] ?? '';

test.beforeEach(async ({ page }) => {
	await page.goto('/admin/login', { waitUntil: 'networkidle' });
	await page.fill('input[type="email"]', EMAIL);
	await page.fill('input[type="password"]', PASSWORD);
	await page.getByRole('button', { name: 'Sign In' }).click();

	await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
		timeout: 20000,
	});

	await page.goto('/admin/settings/cache', { waitUntil: 'networkidle' });
	await page.waitForSelector('.apexcharts-canvas', { timeout: 20000 });
	await page.waitForTimeout(1000);
});

test('lays the counts chart legend out on one row', async ({ page }) => {
	await expect(page.locator('.apexcharts-canvas').first()).toBeVisible();

	// The multi-axis legend must lay out on one row — the grouped-vertical fix. A
	// regression (e.g. an apex bump) would stack the items again.
	const rowCount = await page.evaluate(() => {
		const chart = document.querySelector('.apexcharts-canvas');
		const items = [...(chart?.querySelectorAll('.apexcharts-legend-series') ?? [])];
		const tops = items.map((el) => Math.round(el.getBoundingClientRect().top));
		return new Set(tops).size;
	});

	expect(rowCount).toBe(1);
});

// The compact-tooltip rendering (the `.cache-tt-row` HTML) is asserted by the unit
// config-capture test in cache.test.ts. A browser hover to fire it is too flaky
// headless (apex arms its tooltip on a mousemove sequence that doesn't reproduce
// reliably in CI), so it's left to the unit test rather than kept as a flaky e2e.

// The latency chart names every disposition slice — hit serve, fill (cached miss),
// anomaly (flagged-uncacheable miss), the miss umbrella, and both pooled. The series
// are always in the legend even where a slice has no samples yet.
test('the latency chart names the full disposition breakdown', async ({ page }) => {
	// The seeded fill traffic makes the latency chart appear as a second canvas.
	await expect(page.locator('.apexcharts-canvas')).toHaveCount(2, {
		timeout: 10000,
	});

	const names = await page
		.locator('.apexcharts-canvas')
		.nth(1)
		.locator('.apexcharts-legend-series')
		.allInnerTexts();

	const slices = ['Hits p50', 'Fills p50', 'Anomalies p50', 'Misses p50', 'Both p50'];

	for (const label of slices) {
		expect(names).toContain(label);
	}
});

// Legend visibility is persisted to localStorage per chart: p95 bands hidden by
// default, and a toggle survives a reload. The honest end-to-end check — the unit
// test can only drive the handler directly, not apex's real legend click.
test('p95 hidden by default; a legend toggle persists a reload', async ({ page }) => {
	await expect(page.locator('.apexcharts-canvas')).toHaveCount(2, {
		timeout: 10000,
	});

	const latency = () => page.locator('.apexcharts-canvas').nth(1);
	const inactive = (text: string) =>
		latency()
			.locator('.apexcharts-legend-series.apexcharts-inactive-legend')
			.filter({ hasText: text });

	// p95 start hidden (persisted default) — their legend item is greyed inactive.
	await expect(inactive('Misses p95')).toHaveCount(1);

	// Hide a p50 via its legend; it goes inactive.
	await latency()
		.locator('.apexcharts-legend-series')
		.filter({ hasText: 'Hits p50' })
		.click();

	await expect(inactive('Hits p50')).toHaveCount(1);

	// Reload — the toggle must survive (localStorage-backed).
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForSelector('.apexcharts-canvas', { timeout: 20000 });
	await page.waitForTimeout(1000);

	await expect(inactive('Hits p50')).toHaveCount(1, { timeout: 10000 });
});
