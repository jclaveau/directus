import type { AbstractService, PrimaryKey } from '@directus/types';
import type { Knex } from 'knex';

type DeletedBeneficiaries = {
	trx: Knex;
	accessService: AbstractService;
	beneficiaryKeys: PrimaryKey[];
};

/**
 * A deleted beneficiary row takes its access along. An access a row left in
 * place still shares, a resumed subscription's, stays: that row grants it.
 */
export async function revokeDeletedBeneficiaryAccesses({
	trx,
	accessService,
	beneficiaryKeys,
}: DeletedBeneficiaries): Promise<void> {
	const deletedAccessRows = await trx('subscription_beneficiaries')
		.distinct('access')
		.whereIn('id', beneficiaryKeys)
		.whereNotNull('access')
		.orderBy('access');

	for (const { access: deletedAccess } of deletedAccessRows) {
		const sharingBeneficiary = await trx('subscription_beneficiaries')
			.first('id')
			.where('access', deletedAccess)
			.whereNotIn('id', beneficiaryKeys);

		if (sharingBeneficiary === undefined) {
			await accessService.deleteOne(deletedAccess);
		}
	}
}
