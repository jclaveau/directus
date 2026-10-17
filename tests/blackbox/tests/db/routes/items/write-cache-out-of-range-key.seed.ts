import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

const slotScoped = { scoped_cache_fields: ['slot'], accountability: null };

const slotBodyFields = [
	{ field: 'slot', type: 'string', meta: {} },
	{ field: 'body', type: 'string', meta: {} },
];

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				for (const collection of [
					'test_wca_update',
					'test_wca_upsert',
					'test_wca_create',
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: 'test_wca_update',
							meta: slotScoped,
							fields: slotBodyFields,
						},
						{
							collection: 'test_wca_upsert',
							meta: slotScoped,
							fields: slotBodyFields,
						},
						{
							collection: 'test_wca_create',
							meta: slotScoped,
							fields: slotBodyFields,
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
