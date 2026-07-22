import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionUnique = 'test_items_db_error_unique';
export const collectionContainsNull = 'test_items_db_error_contains_null';
export const collectionFkParent = 'test_items_db_error_fk_parent';
export const collectionFkChild = 'test_items_db_error_fk_child';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Clean up any previous run. Independent collections drop in
				// parallel; the FK pair stays chained child-before-parent (dropping
				// the parent table while the child's FK references it would error).
				await Promise.allSettled([
					DeleteCollection(vendor, { collection: collectionFkChild }).then(
						() => DeleteCollection(vendor, { collection: collectionFkParent }),
					),
					DeleteCollection(vendor, { collection: collectionUnique }),
					DeleteCollection(vendor, { collection: collectionContainsNull }),
				]);

				// One batch POST creates all four collections, each with its fields
				// folded in:
				// - unique: a db-level unique field, no app validation, so a duplicate
				//   insert reaches the database and surfaces as RECORD_NOT_UNIQUE.
				// - contains_null: a nullable field the test later alters to NOT NULL while
				//   a row holds null, surfacing CONTAINS_NULL_VALUES from the schema alter.
				// - fk_parent/fk_child: the child gets a NO ACTION M2O below, so pointing
				//   it at a missing parent id surfaces INVALID_FOREIGN_KEY on insert, and
				//   deleting a still-referenced parent surfaces it on delete.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionUnique,
							fields: [
								{
									field: 'code',
									type: 'string',
									meta: {},
									schema: { is_unique: true },
								},
							],
						},
						{
							collection: collectionContainsNull,
							fields: [
								{
									field: 'label',
									type: 'string',
									meta: {},
									schema: { is_nullable: true },
								},
							],
						},
						{ collection: collectionFkParent },
						{ collection: collectionFkChild },
					],
				});

				await CreateFieldM2O(vendor, {
					collection: collectionFkChild,
					field: 'parent',
					otherCollection: collectionFkParent,
					relationSchema: { on_delete: 'NO ACTION' },
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
