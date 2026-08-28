import {
	CreateCollection,
	CreateField,
	CreateFieldM2O,
	CreateFieldO2M,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { PRIMARY_KEY_TYPES } from '@common/variables';
import { expect, it } from 'vitest';

export const collectionUnits = 'test_items_shared_nested_units';
export const collectionDisciplines = 'test_items_shared_nested_disciplines';
export const collectionSegments = 'test_items_shared_nested_segments';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			for (const pkType of PRIMARY_KEY_TYPES) {
				try {
					const localCollectionUnits = `${collectionUnits}_${pkType}`;
					const localCollectionDisciplines = `${collectionDisciplines}_${pkType}`;
					const localCollectionSegments = `${collectionSegments}_${pkType}`;

					await DeleteCollection(vendor, { collection: localCollectionUnits });
					await DeleteCollection(vendor, { collection: localCollectionSegments });
					await DeleteCollection(vendor, { collection: localCollectionDisciplines });

					await CreateCollection(vendor, {
						collection: localCollectionDisciplines,
						primaryKeyType: pkType,
						meta: {},
						schema: {},
					});

					await CreateField(vendor, {
						collection: localCollectionDisciplines,
						field: 'name',
						type: 'string',
						meta: {},
						schema: {},
					});

					await CreateCollection(vendor, {
						collection: localCollectionSegments,
						primaryKeyType: pkType,
						meta: {},
						schema: {},
					});

					// The discipline's own children. A read asking for `segments`
					// without naming a field of theirs collapses them to keys —
					// the exit that used to answer differently on a second visit.
					await CreateFieldO2M(vendor, {
						collection: localCollectionDisciplines,
						field: 'segments',
						otherCollection: localCollectionSegments,
						otherField: 'discipline',
						primaryKeyType: pkType,
					});

					await CreateCollection(vendor, {
						collection: localCollectionUnits,
						primaryKeyType: pkType,
						meta: {},
						schema: {},
					});

					// Several units point at ONE discipline: directus resolves that
					// row once and hands the same object to every unit, so the
					// projection visits it repeatedly.
					await CreateFieldM2O(vendor, {
						collection: localCollectionUnits,
						field: 'discipline',
						otherCollection: localCollectionDisciplines,
						primaryKeyType: pkType,
					});

					expect(true).toBeTruthy();
				}
				catch (error) {
					expect(error).toBeFalsy();
				}
			}
		},
		300_000,
	);
};
