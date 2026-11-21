import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';
import { addBeneficiary } from './add-beneficiary.js';

export type OwnBeneficiaryAdd = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	userId: string | null;
	requestBody: unknown;
	// Sends the invite mail of a user this add created.
	inviteUser: (invitedEmail: string) => Promise<void>;
};

type BeneficiaryPayload = { subscription: number }
	& ({ user: string; email: null } | { user: null; email: string });

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `POST /subscriptions/beneficiaries`: a manager seats a user on the plan,
 * named by id or by email. An email with no account invites a user, whose
 * mail goes once the seat is committed.
 */
export async function addOwnBeneficiary({
	database,
	enabledProviders,
	userId,
	requestBody,
	inviteUser,
}: OwnBeneficiaryAdd): Promise<number> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const beneficiaryPayload = readBeneficiaryPayload(requestBody);
	const { subscription } = beneficiaryPayload;
	let invitedEmail: string | null = null;

	const beneficiaryId = await database.transaction(async (trx) => {
		const managedSubscription = await trx('subscriptions')
			.join(
				'subscription_managers',
				'subscription_managers.subscription',
				'subscriptions.id',
			)
			.select(
				'subscriptions.provider',
				'subscriptions.provider_subscription_id',
				'subscriptions.provider_customer_id',
			)
			.where('subscriptions.id', subscription)
			.where('subscription_managers.user', userId)
			.first();

		// Not telling a stranger which subscriptions exist.
		if (managedSubscription === undefined) {
			throw new ForbiddenError();
		}

		let user: string;

		if (beneficiaryPayload.user === null) {
			const emailUser = await readEmailUser(trx, beneficiaryPayload.email);

			// Rolled back with the seat when the plan has none left.
			user = emailUser ?? await createInvitedUser(trx, beneficiaryPayload.email);

			invitedEmail = emailUser === null
				? beneficiaryPayload.email
				: null;
		}
		else {
			user = beneficiaryPayload.user;

			// The insert's foreign key would answer a 500.
			const seatedUser = await trx('directus_users')
				.first('id')
				.where('id', user);

			if (seatedUser === undefined) {
				throw new InvalidPayloadError({
					reason: `User ${JSON.stringify(user)} does not exist`,
				});
			}
		}

		const addedId = await addBeneficiary(trx, { subscription, user });

		// A pending row grants nothing yet: its first sync seats them all.
		if (managedSubscription.provider_subscription_id !== null) {
			const subscriptionProvider = findProvider(
				enabledProviders,
				managedSubscription.provider,
			);

			await enqueueSync(trx, {
				provider: managedSubscription.provider,
				resourceId: subscriptionProvider.composeResourceId({
					subscriptionId: managedSubscription.provider_subscription_id,
					customerId: managedSubscription.provider_customer_id,
				}),
			});
		}

		return addedId;
	});

	if (invitedEmail !== null) {
		await inviteUser(invitedEmail);
	}

	return beneficiaryId;
}

async function readEmailUser(
	trx: Knex,
	seatedEmail: string,
): Promise<string | null> {
	const emailUser = await trx('directus_users')
		.first('id')
		.whereRaw('lower(??) = ?', ['email', seatedEmail]);

	return emailUser?.id ?? null;
}

// Swept by `directus subscriptions sweep-invites` once it holds no seat.
async function createInvitedUser(
	trx: Knex,
	invitedEmail: string,
): Promise<string> {
	const invitedUser = randomUUID();

	await trx('directus_users')
		.insert({ id: invitedUser, email: invitedEmail, status: 'invited' });

	await trx('subscription_invites')
		.insert({ user: invitedUser, date_sent: new Date() });

	return invitedUser;
}

function readBeneficiaryPayload(requestBody: unknown): BeneficiaryPayload {
	const payloadFields = typeof requestBody === 'object' && requestBody !== null
		? requestBody as Record<string, unknown>
		: {};

	const { subscription, user, email } = payloadFields;

	if (!Number.isSafeInteger(subscription) || (subscription as number) < 1) {
		throw new InvalidPayloadError({
			reason: `"subscription" must be a subscription id, got`
				+ ` ${JSON.stringify(subscription ?? null)}`,
		});
	}

	if (user !== undefined && email !== undefined) {
		throw new InvalidPayloadError({
			reason: 'A beneficiary is named by "user" or by "email", not both',
		});
	}

	if (email !== undefined) {
		if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
			throw new InvalidPayloadError({
				reason: `"email" must be an email, got ${JSON.stringify(email)}`,
			});
		}

		return {
			subscription: subscription as number,
			user: null,
			email: email.toLowerCase(),
		};
	}

	if (user === undefined) {
		throw new InvalidPayloadError({
			reason: 'A beneficiary is named by "user" or by "email"',
		});
	}

	if (typeof user !== 'string' || !UUID_PATTERN.test(user)) {
		throw new InvalidPayloadError({
			reason: `"user" must be a user id, got ${JSON.stringify(user)}`,
		});
	}

	return { subscription: subscription as number, user, email: null };
}
