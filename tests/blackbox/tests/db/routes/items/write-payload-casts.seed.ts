import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionCastRow = 'test_write_cast_row';
export const collectionCastActivity = 'test_write_cast_activity';
export const collectionCastSingle = 'test_write_cast_single';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				for (const collection of [
					collectionCastRow,
					collectionCastActivity,
					collectionCastSingle,
				]) {
					await DeleteCollection(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionCastRow,
							primaryKeyType: 'string',
							fields: [
								{
									field: 'flag',
									type: 'boolean',
									meta: { special: ['cast-boolean'] },
								},
								{
									field: 'notes',
									type: 'text',
									meta: { special: ['cast-json'] },
								},
								{
									field: 'tags',
									type: 'csv',
									meta: { special: ['cast-csv'] },
								},
								{
									field: 'role_created',
									type: 'string',
									meta: { special: ['role-created'] },
								},
								{
									field: 'role_updated',
									type: 'string',
									meta: { special: ['role-updated'] },
								},
								{ field: 'day', type: 'date', meta: {} },
								{ field: 'moment', type: 'dateTime', meta: {} },
							],
						},
						{
							collection: collectionCastActivity,
							primaryKeyType: 'string',
							meta: { accountability: 'activity' },
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							// Never written, so a read answers its defaults.
							collection: collectionCastSingle,
							meta: { singleton: true },
							fields: [
								{
									field: 'motto',
									type: 'string',
									meta: {},
									schema: { default_value: 'hello' },
								},
								{ field: 'visits', type: 'integer', meta: {} },
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
