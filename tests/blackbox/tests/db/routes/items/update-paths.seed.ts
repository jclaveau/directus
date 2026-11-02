import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionPaths = 'test_update_paths';
export const collectionPathsLog = 'test_update_paths_log';
export const collectionPathsChild = 'test_update_paths_child';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, {
					collection: collectionPathsChild,
				});

				await DeleteCollectionIfPresent(vendor, { collection: collectionPaths });
				await DeleteCollectionIfPresent(vendor, { collection: collectionPathsLog });

				await CreateCollections(vendor, {
					collections: [
						{
							// `accountability: 'all'` is what makes the update write
							// revisions, which is where the nested-revision parenting
							// this suite covers happens.
							collection: collectionPaths,
							meta: { accountability: 'all' },
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionPathsChild,
							meta: { accountability: 'all' },
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionPathsLog,
							meta: {},
							fields: [{ field: 'phase', type: 'string', meta: {} }],
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: collectionPaths,
					field: 'children',
					primaryKeyType: 'integer',
					otherCollection: collectionPathsChild,
					otherField: 'parent',
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
