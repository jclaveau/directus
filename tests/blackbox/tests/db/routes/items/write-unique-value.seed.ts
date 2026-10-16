import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionUniqueCode = 'test_write_unique_code';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionUniqueCode });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionUniqueCode,
							primaryKeyType: 'integer',
							fields: [
								{
									field: 'code',
									type: 'string',
									meta: {},
									schema: { is_unique: true },
								},
							],
						},
					],
				});

				expect(true).toBeTruthy();
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
