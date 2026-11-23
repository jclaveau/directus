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

export const NO_SUBSCRIPTION_LINE = 'You have no subscription';

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
	return `${examplesPlan.name} ${formatAmount(examplesPlan.amount)}`
		+ ` ${examplesPlan.currency} / ${formatInterval(examplesPlan.interval)}`;
}

export function isLiveSubscription(mineSubscription: MineSubscription): boolean {
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
		`${mineSubscription.plan.name} · ${mineSubscription.status}`,
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
