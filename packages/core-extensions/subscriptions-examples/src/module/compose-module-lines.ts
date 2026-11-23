export type ExamplesPlan = {
	code: string;
	name: string;
	amount: string | number;
	currency: string;
	interval: string | Record<string, number>;
	beneficiaries_max: number | null;
};

/** One row of `GET /subscriptions/mine`; managers also get the price. */
export type MineSubscription = {
	id: number;
	plan: { code: string; name: string };
	provider: string;
	status: string;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
	roles: string[];
	amount?: string;
	currency?: string;
	beneficiaries?: string[];
};

/** One row of `GET /subscriptions/:id/invoices`. */
export type SubscriptionInvoice = {
	provider: string;
	provider_reference: string;
	status: string;
	amount: string;
	currency: string;
	date_issued: string;
	date_paid: string | null;
	hosted_url: string | null;
	pdf_url: string | null;
};

export const NO_SUBSCRIPTION_LINE = 'You have no subscription';

export const NO_INVOICE_LINE = 'No invoice yet';

const ENDED_STATUSES = ['canceled', 'expired', 'incomplete_expired'];

export function formatInterval(
	planInterval: ExamplesPlan['interval'],
): string {
	const { months = 0, days = 0 } = typeof planInterval === 'string'
		? JSON.parse(planInterval) as Record<string, number>
		: planInterval;

	if (months === 12 && days === 0) {
		return 'year';
	}

	if (days === 0) {
		return months === 1
? 'month'
: `${months} months`;
	}

	if (months === 0) {
		return days === 1
? 'day'
: `${days} days`;
	}

	return `${months} months ${days} days`;
}

export function formatAmount(planAmount: string | number): string {
	return Number(planAmount)
		.toFixed(2);
}

// What a user may type in the amount field: whole units, or up to 2 decimals
// after a dot or a comma.
const TYPED_AMOUNT = /^(\d+)(?:[.,](\d{0,2}))?$/;

/**
 * The checkout takes "14.90" only; "12", "12.5" and "12,5" are padded to it.
 * Any other text goes out as typed, for the checkout to refuse it by name.
 */
export function normalizeCustomAmount(amountText: string): string {
	const trimmedAmount = amountText.trim();
	const amountMatch = TYPED_AMOUNT.exec(trimmedAmount);

	if (amountMatch === null) {
		return trimmedAmount;
	}

	const [, wholePart, decimalPart = ''] = amountMatch;

	return `${wholePart}.${decimalPart.padEnd(2, '0')}`;
}

export function composePlanLine(examplesPlan: ExamplesPlan): string {
	const priceLine = `${examplesPlan.name} ${formatAmount(examplesPlan.amount)}`
		+ ` ${examplesPlan.currency} / ${formatInterval(examplesPlan.interval)}`;

	// A policy that hides the column leaves the seats out rather than guess.
	if (examplesPlan.beneficiaries_max === null) {
		return priceLine;
	}

	return `${priceLine} · ${examplesPlan.beneficiaries_max}`
		+ ` seat${examplesPlan.beneficiaries_max === 1
			? ''
			: 's'}`;
}

/**
 * Mollie marks a cancelled subscription `canceled` at once, while the bundle
 * keeps its access until `current_period_end`: it stays shown till then.
 */
export function isLiveSubscription(
	mineSubscription: MineSubscription,
	checkedAt: Date,
): boolean {
	if (mineSubscription.status === 'canceled'
		&& mineSubscription.cancel_at_period_end
		&& mineSubscription.current_period_end !== null) {
		return new Date(mineSubscription.current_period_end) > checkedAt;
	}

	return !ENDED_STATUSES.includes(mineSubscription.status);
}

export function isManaged(mineSubscription: MineSubscription): boolean {
	return mineSubscription.roles.includes('manager');
}

export function composeSeatLine(
	seatCount: number,
	seatMax: number | null,
): string {
	if (seatMax === null) {
		return `Beneficiaries: ${seatCount}`;
	}

	return `Beneficiaries: ${seatCount} of ${seatMax}`
		+ ` seat${seatMax === 1
? ''
: 's'}`;
}

/**
 * What the module shows of one subscription, the lines before its
 * beneficiaries' emails; `subscriptionPlan` is undefined when the user cannot
 * read the plan.
 */
export function composeSubscriptionLines(
	mineSubscription: MineSubscription,
	subscriptionPlan: ExamplesPlan | undefined,
): string[] {
	const subscriptionLines = [
		`#${mineSubscription.id} ${mineSubscription.plan.name}`
		+ ` · ${mineSubscription.status}`,
	];

	if (isManaged(mineSubscription) && subscriptionPlan !== undefined) {
		subscriptionLines.push(
			`${formatAmount(mineSubscription.amount ?? subscriptionPlan.amount)}`
			+ ` ${mineSubscription.currency ?? subscriptionPlan.currency}`
			+ ` / ${formatInterval(subscriptionPlan.interval)}`,
		);
	}

	if (mineSubscription.current_period_end !== null) {
		const periodDay = mineSubscription.current_period_end.slice(0, 10);

		subscriptionLines.push(mineSubscription.cancel_at_period_end
			? `Ends on ${periodDay}`
			: `Renews on ${periodDay}`);
	}

	if (isManaged(mineSubscription)) {
		subscriptionLines.push(composeSeatLine(
			mineSubscription.beneficiaries?.length ?? 0,
			subscriptionPlan?.beneficiaries_max ?? null,
		));
	}

	return subscriptionLines;
}

/** `2026-11-23 · 25.00 EUR · paid`, the day it was issued. */
export function composeInvoiceLine(
	subscriptionInvoice: SubscriptionInvoice,
): string {
	return `${subscriptionInvoice.date_issued.slice(0, 10)}`
		+ ` · ${formatAmount(subscriptionInvoice.amount)}`
		+ ` ${subscriptionInvoice.currency} · ${subscriptionInvoice.status}`;
}
