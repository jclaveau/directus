import {
	CreateCollections,
	CreateFieldM2M,
	CreateFieldO2M,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionList = 'test_nested_o2m_list';
export const collectionListEntry = 'test_nested_o2m_list_entry';
export const collectionBin = 'test_nested_o2m_bin';
export const collectionBinEntry = 'test_nested_o2m_bin_entry';
export const collectionPost = 'test_nested_o2m_post';
export const collectionTag = 'test_nested_o2m_tag';
export const collectionPostTag = 'test_nested_o2m_post_tag';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionListEntry,
					collectionList,
					collectionBinEntry,
					collectionBin,
					collectionPostTag,
					collectionPost,
					collectionTag,
				]) {
					await DeleteCollection(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes and reads.
				await CreateCollections(vendor, {
					collections: [
						{ collection: collectionList, primaryKeyType: 'string' },
						{
							collection: collectionListEntry,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{ collection: collectionBin, primaryKeyType: 'string' },
						{ collection: collectionBinEntry, primaryKeyType: 'string' },
						{ collection: collectionPost, primaryKeyType: 'string' },
						{ collection: collectionTag, primaryKeyType: 'string' },
						// Created ahead of CreateFieldM2M, which reuses it, so the
						// junction rows carry keys a scenario names too.
						{ collection: collectionPostTag, primaryKeyType: 'string' },
					],
				});

				await CreateFieldO2M(vendor, {
					collection: collectionList,
					field: 'entries',
					primaryKeyType: 'string',
					otherCollection: collectionListEntry,
					otherField: 'list',
				});

				await CreateFieldO2M(vendor, {
					collection: collectionBin,
					field: 'entries',
					primaryKeyType: 'string',
					otherCollection: collectionBinEntry,
					otherField: 'bin',
					relationMeta: { one_deselect_action: 'delete' },
				});

				await CreateFieldM2M(vendor, {
					collection: collectionPost,
					field: 'tags',
					primaryKeyType: 'string',
					otherCollection: collectionTag,
					otherField: 'posts',
					junctionCollection: collectionPostTag,
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
