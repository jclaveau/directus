import { expect, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// The scenarios of subscriptions-examples-module.feature, one test each, against
// a preview booted with @scalabus/subscriptions-examples: its fake providers and
// a Mailpit at MAILPIT_URL. Each test resets what an earlier one left as admin.

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:8055';
const MAILPIT_URL = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
const ADMIN_EMAIL = process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? '';

const TESTER_EMAIL = 'tester@example.com';
const FRIEND_EMAIL = 'friend@example.com';

const LINE_TIMEOUT = { timeout: 20_000 };

function readTodayPlusMonth(): string {
	const renewalDate = new Date();

	renewalDate.setUTCMonth(renewalDate.getUTCMonth() + 1);

	return renewalDate.toISOString()
		.slice(0, 10);
}

async function callAdminApi(
	requestMethod: string,
	requestPath: string,
	requestBody?: object,
): Promise<{ data?: unknown }> {
	const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
	});

	const { data: loginData } = await loginResponse.json() as {
		data: { access_token: string };
	};

	const apiResponse = await fetch(`${BASE_URL}${requestPath}`, {
		method: requestMethod,
		headers: {
			'Authorization': `Bearer ${loginData.access_token}`,
			'Content-Type': 'application/json',
		},
		...requestBody === undefined
? {}
: { body: JSON.stringify(requestBody) },
	});

	if (!apiResponse.ok) {
		throw new Error(
			`${requestMethod} ${JSON.stringify(requestPath)} answered`
			+ ` ${JSON.stringify(apiResponse.status)}:`
			+ ` ${JSON.stringify(await apiResponse.text())}`,
		);
	}

	return apiResponse.status === 204
		? {}
		: await apiResponse.json() as { data?: unknown };
}

async function readMailpitMails(): Promise<{ to: string; subject: string }[]> {
	const mailsResponse = await fetch(`${MAILPIT_URL}/api/v1/messages`);

	const { messages: mailpitMessages } = await mailsResponse.json() as {
		messages: { To: { Address: string }[]; Subject: string }[];
	};

	return mailpitMessages.map((mailpitMessage) => {
		return {
			to: mailpitMessage.To.map((mailRecipient) => mailRecipient.Address)
				.join(','),
			subject: mailpitMessage.Subject,
		};
	});
}

async function readInviteToken(): Promise<string> {
	const searchResponse = await fetch(
		`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${FRIEND_EMAIL}`)}`,
	);

	const { messages: foundMessages } = await searchResponse.json() as {
		messages: { ID: string }[];
	};

	const messageResponse = await fetch(
		`${MAILPIT_URL}/api/v1/message/${foundMessages[0]!.ID}`,
	);

	const { HTML: messageHtml } = await messageResponse.json() as { HTML: string };
	const tokenMatch = /token=([\w.-]+)/.exec(messageHtml);

	if (tokenMatch === null) {
		throw new Error(
			`The invite mail to ${JSON.stringify(FRIEND_EMAIL)} holds no token`,
		);
	}

	return tokenMatch[1]!;
}

async function signIn(page: Page, userEmail: string, userPassword: string) {
	await page.goto('/admin/login', { waitUntil: 'networkidle' });
	await page.fill('input[type="email"]', userEmail);
	await page.fill('input[type="password"]', userPassword);
	await page.getByRole('button', { name: 'Sign In' }).click();

	await page.waitForURL((pageUrl) => !pageUrl.pathname.endsWith('/login'), {
		timeout: 20_000,
	});
}

async function openModule(page: Page) {
	await page.goto('/admin/subscriptions-examples', { waitUntil: 'networkidle' });
}

async function subscribe(
	page: Page,
	planName: string,
	providerName: string,
	customAmount?: string,
) {
	await openModule(page);

	const planBlock = page.locator('.examples-plan', {
		has: page.locator('.examples-line', { hasText: `${planName} ` }),
	});

	if (customAmount !== undefined) {
		await planBlock.getByLabel(`Amount for ${planName}`)
			.fill(customAmount);
	}

	await planBlock.getByRole('button', { name: `Subscribe with ${providerName}` })
		.click();
}

async function pickOutcome(page: Page, providerName: string, payOutcome: string) {
	await expect(page).toHaveTitle(`Fake ${providerName} page`, LINE_TIMEOUT);
	await page.getByRole('button', { name: payOutcome, exact: true }).click();
	await page.waitForURL('**/admin/subscriptions-examples', LINE_TIMEOUT);
}

async function subscribePaid(page: Page, planName: string, providerName: string) {
	await subscribe(page, planName, providerName);
	await pickOutcome(page, providerName, 'paid');

	await expect(page.locator('.examples-line').first())
		.toHaveText(new RegExp(`^#\\d+ ${planName} · active$`), LINE_TIMEOUT);
}

/**
 * The bundle refuses removing a subscription's last manager and any invoice or
 * event through the API, so the reset deletes the sample plans' rows in SQL.
 */
function deleteExamplesSubscriptions(): void {
	const examplesSubscriptions = 'SELECT subscriptions.id FROM subscriptions'
		+ ' JOIN subscription_plans ON subscription_plans.id = subscriptions.plan'
		+ " WHERE subscription_plans.code IN ('basic', 'team', 'yearly')";

	const deleteStatements = [
		`UPDATE subscriptions SET continues = NULL`
		+ ` WHERE continues IN (${examplesSubscriptions})`,
		...[
			'subscription_beneficiaries',
			'subscription_managers',
			'subscription_events',
			'subscription_invoices',
		].map((childTable) => {
			return `DELETE FROM ${childTable}`
				+ ` WHERE subscription IN (${examplesSubscriptions})`;
		}),
		`DELETE FROM subscriptions WHERE id IN (${examplesSubscriptions})`,
	];

	for (const dbVariable of ['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER']) {
		if (process.env[dbVariable] === undefined) {
			throw new Error(
				`${JSON.stringify(dbVariable)} is unset: the reset needs the database`,
			);
		}
	}

	execFileSync('psql', [
		'--no-psqlrc',
		'--set=ON_ERROR_STOP=1',
		'--single-transaction',
		...deleteStatements.map((deleteStatement) => `--command=${deleteStatement}`),
	], {
		env: {
			...process.env,
			PGHOST: process.env['DB_HOST'],
			PGPORT: process.env['DB_PORT'],
			PGDATABASE: process.env['DB_DATABASE'],
			PGUSER: process.env['DB_USER'],
			PGPASSWORD: process.env['DB_PASSWORD'],
		},
	});
}

async function addBeneficiary(page: Page, beneficiaryEmail: string) {
	await page.getByLabel('Beneficiary email')
		.fill(beneficiaryEmail);

	await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
	deleteExamplesSubscriptions();

	await callAdminApi('DELETE', '/users', {
		query: { filter: { email: { _eq: FRIEND_EMAIL } }, limit: -1 },
	});

	await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

	await signIn(page, TESTER_EMAIL, 'tester');
});

test('the module lists the sample plans at their price', async ({ page }) => {
	await openModule(page);

	await expect(page.locator('.examples-line')).toHaveText([
		'Basic 10.00 EUR / month · 1 seat',
		'Team 25.00 EUR / month · 3 seats',
		'Yearly 100.00 EUR / year · 1 seat',
		'You have no subscription',
	], LINE_TIMEOUT);
});

test('the module advises Stripe when Mollie fails', async ({ page }) => {
	await openModule(page);

	await expect(page.locator('.examples-advice')).toHaveText(
		'We favour Mollie, a European payment provider; its in-page checkout is'
		+ ' still young. If it fails, pay with Stripe.',
		LINE_TIMEOUT,
	);
});

test(
	'a plan paid at its price on the fake Mollie page shows as'
		+ ' active',
	async ({ page }) => {
		await subscribe(page, 'Basic', 'Mollie');
		await pickOutcome(page, 'Mollie', 'paid');

		await expect(page.locator('.examples-line')).toHaveText([
			/^#\d+ Basic · active$/,
			'10.00 EUR / month',
			`Renews on ${readTodayPlusMonth()}`,
			'Beneficiaries: 1 of 1 seat',
			TESTER_EMAIL,
		], LINE_TIMEOUT);
	},
);

test(
	'a plan paid above its price on the fake Stripe page shows'
		+ ' that price',
	async ({ page }) => {
		await subscribe(page, 'Team', 'Stripe', '30.00');
		await pickOutcome(page, 'Stripe', 'paid');

		await expect(page.locator('.examples-line')).toHaveText([
			/^#\d+ Team · active$/,
			'30.00 EUR / month',
			`Renews on ${readTodayPlusMonth()}`,
			'Beneficiaries: 1 of 3 seats',
			TESTER_EMAIL,
		], LINE_TIMEOUT);
	},
);

test(
	'an amount under the plan\'s price is refused before any page'
		+ ' opens',
	async ({ page }) => {
		await subscribe(page, 'Team', 'Stripe', '20.00');

		await expect(page.locator('.examples-error')).toHaveText(
			'Invalid payload. "custom_amount" must be at least "25.00", got "20.00".',
			LINE_TIMEOUT,
		);

		await expect(page).toHaveURL(/\/admin\/subscriptions-examples$/);
	},
);

test(
	'a payment canceled on the fake page leaves no subscription',
	async ({ page }) => {
		await subscribe(page, 'Basic', 'Mollie');
		await pickOutcome(page, 'Mollie', 'canceled');

		await expect(page.locator('.examples-line')).toHaveText([
			'Basic 10.00 EUR / month · 1 seat',
			'Team 25.00 EUR / month · 3 seats',
			'Yearly 100.00 EUR / year · 1 seat',
			'You have no subscription',
		], LINE_TIMEOUT);
	},
);

test(
	'a seat given by email invites a user, whose mail reaches'
		+ ' Mailpit',
	async ({ page }) => {
		await subscribePaid(page, 'Team', 'Mollie');
		await addBeneficiary(page, FRIEND_EMAIL);

		await expect(page.locator('.examples-line')).toHaveText([
			/^#\d+ Team · active$/,
			'25.00 EUR / month',
			`Renews on ${readTodayPlusMonth()}`,
			'Beneficiaries: 2 of 3 seats',
			FRIEND_EMAIL,
			TESTER_EMAIL,
		], LINE_TIMEOUT);

		await expect.poll(readMailpitMails, LINE_TIMEOUT).toEqual([
			{ to: FRIEND_EMAIL, subject: 'You\'ve been invited' },
		]);
	},
);

test('a beneficiary removed frees its seat, its user kept', async ({ page }) => {
	await subscribePaid(page, 'Team', 'Mollie');
	await addBeneficiary(page, FRIEND_EMAIL);

	await page.locator('.examples-beneficiary', { hasText: FRIEND_EMAIL })
		.getByRole('button', { name: 'Remove' })
		.click();

	await expect(page.locator('.examples-line')).toHaveText([
		/^#\d+ Team · active$/,
		'25.00 EUR / month',
		`Renews on ${readTodayPlusMonth()}`,
		'Beneficiaries: 1 of 3 seats',
		TESTER_EMAIL,
	], LINE_TIMEOUT);

	const friendPath = `/users?fields=email&filter[email][_eq]=${FRIEND_EMAIL}`;

	expect(await callAdminApi('GET', friendPath))
		.toEqual({ data: [{ email: FRIEND_EMAIL }] });
});

test('a full plan refuses one more seat', async ({ page }) => {
	await subscribePaid(page, 'Basic', 'Mollie');
	await addBeneficiary(page, FRIEND_EMAIL);

	await expect(page.locator('.examples-error'))
		.toHaveText('Plan "basic" allows 1 beneficiaries, all taken', LINE_TIMEOUT);
});

test(
	'a subscription cancelled at period end says when it ends',
	async ({ page }) => {
		await subscribePaid(page, 'Basic', 'Stripe');
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();

		await expect(page.locator('.examples-line')).toHaveText([
			/^#\d+ Basic · active$/,
			'10.00 EUR / month',
			`Ends on ${readTodayPlusMonth()}`,
			'Beneficiaries: 1 of 1 seat',
			TESTER_EMAIL,
		], LINE_TIMEOUT);
	},
);

test(
	'a seated user sees the subscription, not its price nor its'
		+ ' seats',
	async ({ page }) => {
		await subscribePaid(page, 'Team', 'Mollie');
		await addBeneficiary(page, FRIEND_EMAIL);

		await expect.poll(readMailpitMails, LINE_TIMEOUT)
			.toHaveLength(1);

		const inviteToken = await readInviteToken();

		const acceptResponse = await fetch(`${BASE_URL}/users/invite/accept`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: inviteToken, password: 'friend' }),
		});

		expect(acceptResponse.status).toBe(204);

		await page.context()
			.clearCookies();

		await signIn(page, FRIEND_EMAIL, 'friend');
		await openModule(page);

		await expect(page.locator('.examples-line')).toHaveText([
			/^#\d+ Team · active$/,
			`Renews on ${readTodayPlusMonth()}`,
		], LINE_TIMEOUT);

		await expect(page.getByRole('button', { name: 'Cancel', exact: true }))
			.toHaveCount(0);
	},
);
