import { expect, test } from '@playwright/test';

// The built admin opens and signs in. A chunk the browser can't run leaves every
// page blank while the build, the unit tests and /server/health all stay green:
// the admin shipped broken once with `SyntaxError: await is a reserved identifier`.

const ADMIN_EMAIL = process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? '';

test('opens the login page and signs in without a page error', async ({ page }) => {
	const pageErrors: string[] = [];

	page.on('pageerror', (pageError) => {
		pageErrors.push(`${pageError.name}: ${pageError.message}`);
	});

	await page.goto('/admin/login', { waitUntil: 'networkidle' });

	// Before waiting on the form, so a blank admin fails on its cause, not a timeout.
	expect(pageErrors).toEqual([]);

	await page.fill('input[type="email"]', ADMIN_EMAIL);
	await page.fill('input[type="password"]', ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Sign In' }).click();

	await page.waitForURL('**/admin/content', { timeout: 20000 });

	expect(pageErrors).toEqual([]);
});
