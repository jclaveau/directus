import { defineConfig, devices } from '@playwright/test';

// Informational browser smoke for the cache page. BASE_URL points at a Directus
// that serves the admin (CI: http://localhost:8055; local dev: the Vite app).
export default defineConfig({
	testDir: '.',
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	retries: process.env['CI'] ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL: process.env['BASE_URL'] ?? 'http://localhost:8055',
		headless: true,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
});
