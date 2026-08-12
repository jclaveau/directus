import { expect, test } from '@playwright/test';

// Acceptance tests for the fork's cache page in a real browser — the behaviour jsdom
// can't drive (chart legend layout + persistence, tooltip, the latency chart).
// Boots against a seeded Directus that serves the admin at BASE_URL/admin.

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

test('lays the counts chart legend out on two meaning rows', async ({ page }) => {
	await expect(page.locator('.apexcharts-canvas').first()).toBeVisible();

	// The page renders this legend itself rather than letting apex group it per
	// y-axis: the split that reads is by meaning, not by scale. Row one is the raw
	// funnel and the TTL those entries were written under; row two the metrics
	// derived from them.
	const rows = page.locator('.cache-counts-legend')
		.locator('.cache-chart-legend-row');

	await expect(rows).toHaveCount(2);

	const entries = (index: number) => {
		return rows.nth(index)
			.locator('.cache-chart-legend-entry')
			.allInnerTexts();
	};

	const raw = await entries(0);
	const derived = await entries(1);

	expect(raw.map((name) => name.trim())).toEqual([
		'TTL',
		'Responses',
		'Misses',
		'Anomalies',
		'Fills',
		'Hits',
		'Purges',
	]);

	expect(derived.map((name) => name.trim())).toEqual([
		'Lifetime',
		'Hit Ratio',
		'Purge Ratio',
		'Coarse purges',
	]);

	// Each row still lays out on one line — the reason apex's own legend was
	// dropped was that it stacked its groups vertically.
	for (const row of [rows.nth(0), rows.nth(1)]) {
		const lines = await row
			.locator('.cache-chart-legend-entry')
			.evaluateAll((els) => {
				const tops = els.map((el) => {
					return Math.round(el.getBoundingClientRect().top);
				});

				return new Set(tops).size;
			});

		expect(lines).toBe(1);
	}
});

// The compact-tooltip rendering (the `.cache-tt-row` HTML) is asserted by the unit
// config-capture test in cache.test.ts. A browser hover to fire it is too flaky
// headless (apex arms its tooltip on a mousemove sequence that doesn't reproduce
// reliably in CI), so it's left to the unit test rather than kept as a flaky e2e.

// The latency chart names every disposition slice — hit serve, fill (cached miss),
// anomaly (flagged-uncacheable miss), the miss umbrella, and both pooled. Its legend
// is the page's own, not apex's: one row per percentile, each naming every slice, so
// a slice with no samples yet is still listed.
test('the latency chart names the full disposition breakdown', async ({ page }) => {
	// The seeded fill traffic makes the latency chart appear as a second canvas.
	await expect(page.locator('.apexcharts-canvas')).toHaveCount(2, {
		timeout: 10000,
	});

	// Two legends carry these classes now (the counts chart grew its own), so
	// this one is addressed by its own modifier rather than by document order.
	const rows = page.locator('.cache-latency-legend .cache-chart-legend-row');
	await expect(rows).toHaveCount(3);

	// Funnel order, the same order the counts chart and the tree read in — purges
	// last, after the read dispositions, being the only slice whose duration is
	// spent inside a write rather than while serving a read.
	const slices = ['Response', 'Misses', 'Anomalies', 'Fills', 'Hits', 'Purges'];

	for (const percentile of ['p50', 'p95', 'p99']) {
		const row = rows.filter({ hasText: percentile });
		await expect(row).toHaveCount(1);

		const names = await row.locator('.cache-chart-legend-entry').allInnerTexts();
		expect(names.map((name) => name.trim())).toEqual(slices);
	}
});

// Legend visibility is persisted to localStorage per chart: p95 bands hidden by
// default, and a toggle survives a reload. The honest end-to-end check — the unit
// test can only drive the handler directly, not a real click on the legend.
test('p95 hidden by default; a toggle survives reload', async ({ page }) => {
	await expect(page.locator('.apexcharts-canvas')).toHaveCount(2, {
		timeout: 10000,
	});

	const entry = (percentile: string, slice: string) => {
		return page
			.locator('.cache-chart-legend-row')
			.filter({ hasText: percentile })
			.locator('.cache-chart-legend-entry')
			.filter({ hasText: slice });
	};

	// p95 starts hidden (persisted default) — its entries render muted. The state is
	// applied after the chart's async render resolves, so give a cold runner room.
	await expect(entry('p95', 'Misses')).toHaveClass(/is-muted/, { timeout: 15000 });
	await expect(entry('p50', 'Hits')).not.toHaveClass(/is-muted/);

	// Hide a p50 slice by clicking it; it goes muted.
	await entry('p50', 'Hits').click();
	await expect(entry('p50', 'Hits')).toHaveClass(/is-muted/, { timeout: 10000 });

	// Reload — the toggle must survive (localStorage-backed).
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForSelector('.cache-chart-legend-row', { timeout: 20000 });

	await expect(entry('p50', 'Hits')).toHaveClass(/is-muted/, { timeout: 10000 });
});
