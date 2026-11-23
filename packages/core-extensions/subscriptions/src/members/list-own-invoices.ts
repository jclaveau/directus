import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';

export type OwnInvoice = {
	id: number;
	provider_reference: string;
	status: string;
	amount: string;
	currency: string;
	date_issued: string;
	date_paid: string | null;
	hosted_url: string | null;
	pdf_url: string | null;
};

const SUBSCRIPTION_ID = /^[1-9]\d*$/;

/**
 * `GET /subscriptions/:id/invoices`: what the providers billed for a
 * subscription the user manages, newest first. Anyone else gets 403, a
 * missing subscription too.
 */
export async function listOwnInvoices(
	database: Knex,
	userId: string | null,
	subscriptionParam: string,
): Promise<OwnInvoice[]> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	if (!SUBSCRIPTION_ID.test(subscriptionParam)) {
		throw new InvalidPayloadError({
			reason: `"id" must be a subscription id, got`
				+ ` ${JSON.stringify(subscriptionParam)}`,
		});
	}

	const subscriptionId = Number(subscriptionParam);

	const managerRow = await database('subscription_managers')
		.first('id')
		.where({ subscription: subscriptionId, user: userId });

	if (managerRow === undefined) {
		throw new ForbiddenError();
	}

	const invoiceRows = await database('subscription_invoices')
		.select(
			'id',
			'provider_reference',
			'status',
			'amount',
			'currency',
			'date_issued',
			'date_paid',
			'hosted_url',
			'pdf_url',
		)
		.where('subscription', subscriptionId)
		.orderBy([
			{ column: 'date_issued', order: 'desc' },
			{ column: 'id', order: 'desc' },
		]);

	return invoiceRows.map((invoiceRow): OwnInvoice => {
		return {
			id: invoiceRow.id,
			provider_reference: invoiceRow.provider_reference,
			status: invoiceRow.status,
			// A decimal column: Postgres hands back "25.00", SQLite 25.
			amount: Number(invoiceRow.amount)
				.toFixed(2),
			currency: invoiceRow.currency,
			date_issued: new Date(invoiceRow.date_issued)
				.toISOString(),
			date_paid: invoiceRow.date_paid === null
				? null
				: new Date(invoiceRow.date_paid)
					.toISOString(),
			hosted_url: invoiceRow.hosted_url,
			pdf_url: invoiceRow.pdf_url,
		};
	});
}
