// Plans and users for the admin preview of the subscriptions bundle. Run by
// the preview workflow against its own instance, as admin; the preview passes
// no provider key, so nothing here reaches Stripe or Mollie.

/* eslint-disable no-console -- a CLI, stdout is its output */

const BASE_URL = process.env.PREVIEW_BASE_URL ?? 'http://localhost:8055';

const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		email: 'admin@example.com',
		password: process.env.ADMIN_PASSWORD,
	}),
});

const adminToken = (await readCreated(loginResponse, '/auth/login')).access_token;

const PLANS = [
	{
		code: 'starter',
		name: 'Starter',
		amount: 9.9,
		currency: 'EUR',
		interval: '{"months":1}',
		beneficiaries_max: 1,
	},
	{
		code: 'pro',
		name: 'Pro',
		amount: 29,
		currency: 'EUR',
		interval: '{"months":1}',
		beneficiaries_max: 2,
	},
	{
		code: 'pro-yearly',
		name: 'Pro yearly',
		amount: 290,
		currency: 'EUR',
		interval: '{"years":1}',
		beneficiaries_max: 2,
	},
	{
		code: 'team-quarterly',
		name: 'Team quarterly',
		amount: 199,
		currency: 'USD',
		interval: '{"months":3}',
		beneficiaries_max: 10,
	},
];

const createdPlans = [];

for (const previewPlan of PLANS) {
	const planPolicy = await postAsAdmin('/policies', {
		name: `${previewPlan.name} plan`,
		icon: 'card_membership',
		app_access: false,
		admin_access: false,
	});

	createdPlans.push(await postAsAdmin('/items/subscription_plans', {
		...previewPlan,
		policy: planPolicy.id,
	}));
}

const PREVIEW_USERS = [
	{ first_name: 'Ada', last_name: 'Subscriber', email: 'ada@example.com' },
	{ first_name: 'Linus', last_name: 'Subscriber', email: 'linus@example.com' },
	{ first_name: 'Grace', last_name: 'Visitor', email: 'grace@example.com' },
];

const createdUsers = await postAsAdmin('/users', PREVIEW_USERS);

// Ada and Linus share a pending Pro subscription, both managing and
// benefiting from it; Grace stays a plain user.
const seededAt = new Date().toISOString();

const proSubscription = await postAsAdmin('/items/subscriptions', {
	plan: createdPlans[1].id,
	provider: 'mollie',
	status: 'pending',
	date_created: seededAt,
	date_updated: seededAt,
});

const sharingUsers = createdUsers.slice(0, 2).map((createdUser) => {
	return { subscription: proSubscription.id, user: createdUser.id };
});

await postAsAdmin('/items/subscription_managers', sharingUsers);
await postAsAdmin('/items/subscription_beneficiaries', sharingUsers);

console.log(
	`seeded ${PLANS.length} plans, ${PREVIEW_USERS.length} users and`
	+ ' 1 pending subscription',
);

async function postAsAdmin(requestPath, requestBody) {
	const postResponse = await fetch(`${BASE_URL}${requestPath}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${adminToken}`,
		},
		body: JSON.stringify(requestBody),
	});

	return readCreated(postResponse, requestPath);
}

async function readCreated(apiResponse, requestPath) {
	const responseText = await apiResponse.text();

	if (!apiResponse.ok) {
		throw new Error(
			`POST ${JSON.stringify(requestPath)} answered`
			+ ` ${JSON.stringify(apiResponse.status)}: ${JSON.stringify(responseText)}`,
		);
	}

	return JSON.parse(responseText).data;
}
