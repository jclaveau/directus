import { getUrl } from '@common/config';
import {
	CreateCollections,
	CreateFieldO2M,
	CreateRelation,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect, it } from 'vitest';

export const collectionPartialRow = 'test_wpp_row';
export const collectionPartialParent = 'test_wpp_parent';
export const collectionPartialChild = 'test_wpp_child';
export const collectionPartialLeaf = 'test_wpp_leaf';
export const collectionPartialNote = 'test_wpp_note';
export const collectionPartialGenerated = 'test_wpp_generated';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				for (const collection of [
					collectionPartialRow,
					collectionPartialLeaf,
					collectionPartialNote,
					collectionPartialChild,
					collectionPartialParent,
					collectionPartialGenerated,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionPartialRow,
							primaryKeyType: 'string',
							fields: [
								{
									field: 'answer',
									type: 'string',
									meta: { special: ['cast-boolean'] },
								},
								{
									field: 'role_made',
									type: 'string',
									meta: { special: ['role-created'] },
								},
								{
									field: 'role_changed',
									type: 'string',
									meta: { special: ['role-updated'] },
								},
								{ field: 'spot', type: 'geometry.Point', meta: {} },
								{ field: 'day', type: 'date', meta: {} },
								{ field: 'moment', type: 'dateTime', meta: {} },
							],
						},
						{
							collection: collectionPartialParent,
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionPartialChild,
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'target', type: 'string', meta: {} },
								{ field: 'target_collection', type: 'string', meta: {} },
							],
						},
						{
							collection: collectionPartialLeaf,
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionPartialNote,
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: collectionPartialParent,
					field: 'children',
					otherCollection: collectionPartialChild,
					otherField: 'parent',
				});

				await CreateFieldO2M(vendor, {
					collection: collectionPartialChild,
					field: 'leaves',
					otherCollection: collectionPartialLeaf,
					otherField: 'child',
					relationMeta: { one_deselect_action: 'delete' },
				});

				await CreateFieldO2M(vendor, {
					collection: collectionPartialChild,
					field: 'notes',
					otherCollection: collectionPartialNote,
					otherField: 'child',
				});

				await CreateRelation(vendor, {
					collection: collectionPartialChild,
					field: 'target',
					related_collection: null,
					meta: {
						one_allowed_collections: [collectionPartialLeaf],
						one_collection_field: 'target_collection',
					},
					schema: null,
				});

				// A uuid key the database draws, with no `uuid` special to draw it.
				const generatedResponse = await request(getUrl(vendor))
					.post('/collections')
					.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
					.send({
						collection: collectionPartialGenerated,
						meta: {},
						schema: {},
						fields: [
							{
								field: 'id',
								type: 'uuid',
								meta: { hidden: true, readonly: true },
								schema: {
									is_primary_key: true,
									length: 36,
									has_auto_increment: false,
									default_value: 'gen_random_uuid()',
								},
							},
							{ field: 'label', type: 'string', meta: {}, schema: {} },
						],
					});

				expect(generatedResponse.statusCode).toBe(200);
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
