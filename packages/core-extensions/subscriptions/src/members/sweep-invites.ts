import type { Knex } from 'knex';

export const INVITE_DAYS_KEPT = 30;

const DAY_MILLISECONDS = 86_400_000;

/**
 * Deletes the users still `invited` whose invite was sent more than
 * `INVITE_DAYS_KEPT` days ago and who hold no seat: a removed beneficiary
 * never accepting its invite. Answers how many it deleted.
 */
export async function sweepInvites(database: Knex): Promise<number> {
	const sentBefore = new Date(Date.now() - INVITE_DAYS_KEPT * DAY_MILLISECONDS);

	return await database.transaction(async (trx) => {
		const sweptUsers = await trx('subscription_invites')
			.join('directus_users', 'directus_users.id', 'subscription_invites.user')
			.where('directus_users.status', 'invited')
			.where('subscription_invites.date_sent', '<', sentBefore)
			.whereNotExists((seatQuery) => {
				seatQuery.select('subscription_beneficiaries.id')
					.from('subscription_beneficiaries')
					.whereRaw('?? = ??', [
						'subscription_beneficiaries.user',
						'directus_users.id',
					]);
			})
			.pluck('directus_users.id');

		if (sweptUsers.length === 0) {
			return 0;
		}

		await trx('directus_users')
			.whereIn('id', sweptUsers)
			.delete();

		return sweptUsers.length;
	});
}
