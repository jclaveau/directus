import { defineConfig, devices } from '@playwright/test';

// Browser acceptance tests for the app. BASE_URL points at a Directus that serves
// the admin (CI: http://localhost:8055; local dev: the Vite app).
export default defineConfig({
	testDir: '.',
	// Heavy per test: boots two chart renders, a legend click and a full reload; a
	// cold CI runner needs headroom over the default 30s.
	timeout: 60_000,
	fullyParallel: false,
	workers: 1,
	retries: process.env['CI'] ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL: process.env['BASE_URL'] ?? 'http://localhost:8055',
		headless: true,
		// Tall enough that both stacked charts (counts + latency) are in view — a
		// short viewport pushes the latency markers below the fold.
		viewport: { width: 1400, height: 1200 },
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
});
