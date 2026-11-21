import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';
import type {
	CheckoutStart,
	SubscriptionProvider,
	SubscriptionProviders,
} from '../providers/types.js';
import { readPlanInterval } from '../sync/sync-subscription.js';
import { addBeneficiary } from './add-beneficiary.js';
import { addManager } from './add-manager.js';
import { createPendingSubscription } from './create-pending-subscription.js';

export type CheckoutCreate = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	checkoutUrlAllowList: URL[];
	userId: string | null;
	requestBody: unknown;
};

export type CreatedCheckout = {
	subscription: number;
	url: string;
};

type CheckoutPayload = {
	planCode: unknown;
	providerName: string;
	customAmount: string | null;
	redirectUrl: string;
};

type SoldPlan = {
	id: number;
	code: string;
	name: string;
	status: string;
	amount: number | string;
	currency: string;
	interval: string;
};

const CHECKOUT_AMOUNT = /^\d+\.\d{2}$/;

/**
 * `POST /subscriptions/checkout`: the payer manages and benefits from the
 * pending row the provider's page pays for. The provider is called past the
 * commit, so its page never names a rolled-back row.
 */
export async function createCheckout({
	database,
	enabledProviders,
	checkoutUrlAllowList,
	userId,
	requestBody,
}: CheckoutCreate): Promise<CreatedCheckout> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const checkoutPayload = readCheckoutPayload(
		requestBody,
		enabledProviders,
		checkoutUrlAllowList,
	);

	const subscriptionProvider = enabledProviders.get(
		checkoutPayload.providerName,
	) as SubscriptionProvider;

	const checkoutStart = await database.transaction(async (trx) => {
		return await storePendingCheckout(trx, userId, checkoutPayload);
	});

	return {
		subscription: checkoutStart.directusSubscription,
		url: await subscriptionProvider.createCheckout(checkoutStart),
	};
}

function readCheckoutPayload(
	requestBody: unknown,
	enabledProviders: SubscriptionProviders,
	checkoutUrlAllowList: URL[],
): CheckoutPayload {
	const payloadFields: Record<string, unknown> = typeof requestBody === 'object'
		&& requestBody !== null
		? requestBody as Record<string, unknown>
		: {};

	const {
		plan: planCode,
		provider: providerName,
		custom_amount: customAmount,
		redirect_url: redirectUrl,
	} = payloadFields;

	const providerNames = [...enabledProviders.keys()].sort();

	if (typeof providerName !== 'string'
		|| !providerNames.includes(providerName)) {
		throw new InvalidPayloadError({
			reason: `"provider" must be one of ${JSON.stringify(providerNames)},`
				+ ` got ${JSON.stringify(providerName ?? null)}`,
		});
	}

	const isAmountUnset = customAmount === undefined || customAmount === null;

	if (!isAmountUnset
		&& (typeof customAmount !== 'string' || !CHECKOUT_AMOUNT.test(customAmount))) {
		throw new InvalidPayloadError({
			reason: '"custom_amount" must be an amount like "14.90",'
				+ ` got ${JSON.stringify(customAmount)}`,
		});
	}

	if (!isAllowedRedirect(redirectUrl, checkoutUrlAllowList)) {
		throw new InvalidPayloadError({
			reason: `URL ${JSON.stringify(redirectUrl ?? null)} can't be used to`
				+ ' return from a checkout',
		});
	}

	return {
		planCode,
		providerName,
		customAmount: isAmountUnset
			? null
			: customAmount,
		redirectUrl,
	};
}

/** Origin and path: a query string or a fragment never widens the list. */
function isAllowedRedirect(
	redirectUrl: unknown,
	checkoutUrlAllowList: URL[],
): redirectUrl is string {
	if (typeof redirectUrl !== 'string' || !URL.canParse(redirectUrl)) {
		return false;
	}

	const parsedRedirect = new URL(redirectUrl);

	return checkoutUrlAllowList.some((allowedUrl) => {
		return allowedUrl.origin === parsedRedirect.origin
			&& allowedUrl.pathname === parsedRedirect.pathname;
	});
}

/**
 * A payer checking out the same plan again, with the same provider, reuses the
 * pending row no payment bound yet, so abandoned pages leave one row behind.
 */
async function storePendingCheckout(
	trx: Knex,
	userId: string,
	{ planCode, providerName, customAmount, redirectUrl }: CheckoutPayload,
): Promise<CheckoutStart> {
	const soldPlan = await readSoldPlan(trx, planCode);
	const planCents = readAmountCents(soldPlan.amount);

	const soldCents = customAmount === null
		? planCents
		: readAmountCents(customAmount);

	if (soldCents < planCents) {
		throw new InvalidPayloadError({
			reason: `"custom_amount" must be at least`
				+ ` ${JSON.stringify(formatAmountCents(planCents))},`
				+ ` got ${JSON.stringify(customAmount)}`,
		});
	}

	const storedAmount = soldCents === planCents
		? null
		: formatAmountCents(soldCents);

	const payerUser = await trx('directus_users')
		.select('email')
		.where('id', userId)
		.first();

	const pendingRow = await trx('subscriptions')
		.select('id')
		.where({
			payer: userId,
			plan: soldPlan.id,
			provider: providerName,
			status: 'pending',
		})
		.whereNull('provider_subscription_id')
		.first();

	let directusSubscription: number;

	if (pendingRow === undefined) {
		directusSubscription = await createPendingSubscription(trx, {
			plan: soldPlan.id,
			provider: providerName,
			checkoutColumns: { payer: userId, custom_amount: storedAmount },
		});

		await addManager(trx, { subscription: directusSubscription, user: userId });

		await addBeneficiary(trx, {
			subscription: directusSubscription,
			user: userId,
		});
	}
	else {
		directusSubscription = pendingRow.id;

		await trx('subscriptions')
			.where('id', directusSubscription)
			.update({ custom_amount: storedAmount, date_updated: new Date() });
	}

	return {
		directusSubscription,
		payerEmail: payerUser.email,
		amount: {
			currency: soldPlan.currency.toUpperCase(),
			value: formatAmountCents(soldCents),
		},
		interval: readPlanInterval(soldPlan),
		planName: soldPlan.name,
		redirectUrl,
	};
}

async function readSoldPlan(trx: Knex, planCode: unknown): Promise<SoldPlan> {
	const soldPlan: SoldPlan | undefined = typeof planCode === 'string'
		? await trx('subscription_plans')
			.select('id', 'code', 'name', 'status', 'amount', 'currency', 'interval')
			.where('code', planCode)
			.first()
		: undefined;

	if (soldPlan === undefined) {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(planCode ?? null)} does not exist`,
		});
	}

	if (soldPlan.status === 'archived') {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(soldPlan.code)} is archived,`
				+ ' it sells no more',
		});
	}

	if (soldPlan.status !== 'active') {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(soldPlan.code)} is`
				+ ` ${JSON.stringify(soldPlan.status)}, it sells no more`,
		});
	}

	return soldPlan;
}

// A decimal column: Postgres hands back "9.90", SQLite 9.9.
function readAmountCents(decimalAmount: number | string): number {
	return Math.round(Number(decimalAmount) * 100);
}

function formatAmountCents(amountCents: number): string {
	return (amountCents / 100).toFixed(2);
}
