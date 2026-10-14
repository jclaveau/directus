import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const scenarioCollectionPrefixes = [
	'test_hook_rollback_refused',
	'test_hook_rollback_accepted',
	'test_hook_rollback_forbidden',
];

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				for (const prefix of scenarioCollectionPrefixes) {
					await DeleteCollection(vendor, { collection: `${prefix}_witness` });
					await DeleteCollection(vendor, { collection: `${prefix}_item` });
				}

				await CreateCollections(vendor, {
					collections: scenarioCollectionPrefixes.flatMap((prefix) => {
						return [
							{
								collection: `${prefix}_item`,
								fields: [{ field: 'status', type: 'string', meta: {} }],
							},
							{
								collection: `${prefix}_witness`,
								fields: [
									{ field: 'item', type: 'integer', meta: {} },
									{ field: 'note', type: 'string', meta: {} },
								],
							},
						];
					}),
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
