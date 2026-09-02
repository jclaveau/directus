import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionReadHookNull = 'test_read_hook_null';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionReadHookNull });

				await CreateCollections(vendor, {
					collections: [
						{
							// `accountability: 'all'` is what makes an update write a
							// revision, and the revision block is where the read whose
							// hook returns null happens.
							collection: collectionReadHookNull,
							meta: { accountability: 'all' },
							fields: [{ field: 'name', type: 'string', meta: {} }],
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
