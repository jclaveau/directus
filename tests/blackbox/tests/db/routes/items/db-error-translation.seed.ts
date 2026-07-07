import {
	CreateCollection,
	CreateField,
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
				// Clean up any previous run (child before parent for the FK pair)
				await DeleteCollection(vendor, { collection: collectionFkChild });
				await DeleteCollection(vendor, { collection: collectionFkParent });
				await DeleteCollection(vendor, { collection: collectionUnique });
				await DeleteCollection(vendor, { collection: collectionContainsNull });

				// A db-level unique field, without app-level validation, so a duplicate
				// insert reaches the database and surfaces as RECORD_NOT_UNIQUE.
				await CreateCollection(vendor, {
					collection: collectionUnique,
					meta: {},
					schema: {},
				});

				await CreateField(vendor, {
					collection: collectionUnique,
					field: 'code',
					type: 'string',
					meta: {},
					schema: { is_unique: true },
				});

				// A nullable field the test later alters to NOT NULL while a row holds a
				// null, which surfaces as CONTAINS_NULL_VALUES from the schema alter.
				await CreateCollection(vendor, {
					collection: collectionContainsNull,
					meta: {},
					schema: {},
				});

				await CreateField(vendor, {
					collection: collectionContainsNull,
					field: 'label',
					type: 'string',
					meta: {},
					schema: { is_nullable: true },
				});

				// A child with an M2O to a parent, so pointing it at a missing parent id
				// reaches the database and surfaces as INVALID_FOREIGN_KEY.
				await CreateCollection(vendor, {
					collection: collectionFkParent,
					meta: {},
					schema: {},
				});

				await CreateCollection(vendor, {
					collection: collectionFkChild,
					meta: {},
					schema: {},
				});

				await CreateFieldM2O(vendor, {
					collection: collectionFkChild,
					field: 'parent',
					otherCollection: collectionFkParent,
					relationSchema: { on_delete: 'SET NULL' },
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
