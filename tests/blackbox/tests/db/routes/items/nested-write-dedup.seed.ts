import {
	CreateCollections,
	CreateFieldM2O,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					'test_nwd_course_segment',
					'test_nwd_course',
					'test_nwd_segment',
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// A course links schedule segments through junction rows, as the
				// planner's student_course does; a segment's key is generated and
				// its `name` unique, deduplicated by the nested-write-dedup hook.
				await CreateCollections(vendor, {
					collections: [
						{ collection: 'test_nwd_course', primaryKeyType: 'string' },
						{
							collection: 'test_nwd_course_segment',
							primaryKeyType: 'string',
						},
						{
							collection: 'test_nwd_segment',
							fields: [
								{
									field: 'name',
									type: 'string',
									meta: {},
									schema: { is_unique: true },
								},
							],
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: 'test_nwd_course',
					field: 'segments',
					primaryKeyType: 'string',
					otherCollection: 'test_nwd_course_segment',
					otherField: 'course',
				});

				await CreateFieldM2O(vendor, {
					collection: 'test_nwd_course_segment',
					field: 'segment',
					otherCollection: 'test_nwd_segment',
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
