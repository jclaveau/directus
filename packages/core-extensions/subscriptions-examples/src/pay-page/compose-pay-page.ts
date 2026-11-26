export type PayHolding = {
	provider: 'mollie' | 'stripe';
	payment: string;
	status: string;
	amount: string;
	currency: string;
	description: string;
};

export const PAY_OUTCOMES = ['paid', 'failed', 'canceled'];

/** Lets the form post here and its answer redirect to any shop. */
export const PAY_PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline';"
	+ ' form-action *';

const PROVIDER_NAMES = { mollie: 'Mollie', stripe: 'Stripe' };

function escapeHtml(rawText: string): string {
	return rawText
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export function composePayPage(payHolding: PayHolding): string {
	const providerName = PROVIDER_NAMES[payHolding.provider];
	const pageTitle = `Fake ${providerName} page`;

	const outcomeButtons = PAY_OUTCOMES
		.map((payOutcome) => {
			return `<button name="outcome" value="${payOutcome}">`
				+ `${payOutcome}</button>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto;
	padding: 0 1rem; }
button { margin-right: 0.5rem; padding: 0.5rem 1rem; }
</style>
</head>
<body>
<h1>${pageTitle}</h1>
<p>No money moves: the preview fakes ${providerName}.</p>
<p class="pay-description">${escapeHtml(payHolding.description)}</p>
<p class="pay-amount">${escapeHtml(payHolding.amount)}
${escapeHtml(payHolding.currency)}</p>
<p class="pay-status">${escapeHtml(payHolding.status)}</p>
<form method="post">
${outcomeButtons}
</form>
</body>
</html>
`;
}
