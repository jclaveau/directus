import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionOptionRow = 'test_write_option_row';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionOptionRow });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionOptionRow,
							primaryKeyType: 'string',
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{
									field: 'user_created',
									type: 'string',
									meta: { special: ['user-created'] },
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
