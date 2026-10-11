import config from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import knex from 'knex';
import { expect, it } from 'vitest';

export const collectionGrouped = 'test_update_groups';
export const collectionGroupedLog = 'test_update_groups_log';
export const collectionGroupedOwner = 'test_update_groups_owner';
export const collectionGroupedSlot = 'test_update_groups_slot';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionGrouped });
				await DeleteCollection(vendor, { collection: collectionGroupedLog });
				await DeleteCollection(vendor, { collection: collectionGroupedOwner });
				await DeleteCollection(vendor, { collection: collectionGroupedSlot });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionGrouped,
							meta: {},
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'status', type: 'string', meta: {} },
							],
						},
						{
							// What the update-groups-probe hook writes each event into,
							// so the test can read the events back over the API.
							collection: collectionGroupedLog,
							meta: {},
							fields: [
								{ field: 'event', type: 'string', meta: {} },
								{ field: 'phase', type: 'string', meta: {} },
								{ field: 'payload', type: 'text', meta: {} },
							],
						},
						{
							collection: collectionGroupedOwner,
							meta: {},
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'status', type: 'string', meta: {} },
							],
						},
						{
							collection: collectionGroupedSlot,
							meta: {},
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'holder', type: 'string', meta: {} },
								{ field: 'slot', type: 'string', meta: {} },
							],
						},
					],
				});

				// The fields API has no composite unique.
				const db = knex(config.knexConfig[vendor]!);

				try {
					await db.schema.alterTable(collectionGroupedSlot, (table) => {
						table.unique(['holder', 'slot']);
					});
				}
				finally {
					await db.destroy();
				}

				await CreateFieldM2O(vendor, {
					collection: collectionGrouped,
					field: 'owner',
					otherCollection: collectionGroupedOwner,
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
