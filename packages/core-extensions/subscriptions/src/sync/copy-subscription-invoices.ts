import type { Knex } from 'knex';
import type { SubscriptionProvider } from '../providers/types.js';

export type InvoiceCopy = {
	database: Knex;
	subscriptionProvider: SubscriptionProvider;
	providerName: string;
	resourceId: string;
	subscriptionId: number;
	copiedAt: Date;
	logger: {
		warn: (message: string) => void;
	};
};

/**
 * Past the sync's commit, holding no transaction through the provider call. A
 * failure only logs: the access the sync wrote stands, and the subscription's
 * next sync (webhook, daily reconcile) copies the invoices again. An invoice
 * keeps the row it was first copied to.
 */
export async function copySubscriptionInvoices({
	database,
	subscriptionProvider,
	providerName,
	resourceId,
	subscriptionId,
	copiedAt,
	logger,
}: InvoiceCopy): Promise<void> {
	try {
		const providerInvoices = await subscriptionProvider
			.listInvoices(resourceId);

		if (providerInvoices.length === 0) {
			return;
		}

		await database('subscription_invoices')
			.insert(providerInvoices.map((providerInvoice) => {
				return {
					subscription: subscriptionId,
					provider: providerName,
					provider_reference: providerInvoice.providerReference,
					status: providerInvoice.status,
					amount: providerInvoice.amount,
					currency: providerInvoice.currency,
					date_issued: providerInvoice.dateIssued,
					date_paid: providerInvoice.datePaid,
					hosted_url: providerInvoice.hostedUrl,
					pdf_url: providerInvoice.pdfUrl,
					date_updated: copiedAt,
				};
			}))
			.onConflict(['provider', 'provider_reference'])
			.merge([
				'status',
				'amount',
				'currency',
				'date_issued',
				'date_paid',
				'hosted_url',
				'pdf_url',
				'date_updated',
			]);
	}
	catch (copyError) {
		logger.warn(
			`Invoice copy of ${JSON.stringify(providerName)}`
			+ ` ${JSON.stringify(resourceId)} failed, the next sync retries:`
			+ ` ${JSON.stringify(copyError instanceof Error
				? copyError.message
				: copyError)}`,
		);
	}
}
