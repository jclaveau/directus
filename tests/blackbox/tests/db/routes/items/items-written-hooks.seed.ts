import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const scenarioCollectionPrefixes = [
	'test_items_written_create',
	'test_items_written_nested',
	'test_items_written_create_refused',
	'test_items_written_create_answered',
	'test_items_written_create_echoed',
	'test_items_written_update',
	'test_items_written_update_refused',
	'test_items_written_update_echoed',
];

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				for (const prefix of scenarioCollectionPrefixes) {
					await DeleteCollectionIfPresent(vendor, {
						collection: `${prefix}_witness`,
					});

					await DeleteCollectionIfPresent(vendor, {
						collection: `${prefix}_child`,
					});

					await DeleteCollectionIfPresent(vendor, {
						collection: `${prefix}_item`,
					});
				}

				await CreateCollections(vendor, {
					collections: scenarioCollectionPrefixes.flatMap((prefix) => {
						return [
							{
								collection: `${prefix}_item`,
								fields: [{ field: 'status', type: 'string', meta: {} }],
							},
							{
								collection: `${prefix}_child`,
								fields: [{ field: 'name', type: 'string', meta: {} }],
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

				for (const prefix of scenarioCollectionPrefixes) {
					await CreateFieldO2M(vendor, {
						collection: `${prefix}_item`,
						field: 'children',
						otherCollection: `${prefix}_child`,
						otherField: 'item',
					});
				}

				expect(true).toBeTruthy();
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
