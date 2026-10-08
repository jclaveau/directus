import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionCreated = 'test_create_groups';
export const collectionCreatedLog = 'test_create_groups_log';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionCreated });
				await DeleteCollection(vendor, { collection: collectionCreatedLog });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionCreated,
							meta: {},
							fields: [
								{ field: 'name', type: 'string', meta: {} },
							],
						},
						{
							// What the create-groups-probe hook writes each event into,
							// so the test can read the events back over the API.
							collection: collectionCreatedLog,
							meta: {},
							fields: [
								{ field: 'event', type: 'string', meta: {} },
								{ field: 'phase', type: 'string', meta: {} },
								{ field: 'payload', type: 'text', meta: {} },
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
