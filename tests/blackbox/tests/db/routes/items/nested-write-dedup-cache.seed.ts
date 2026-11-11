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
					'test_nwdc_course_segment',
					'test_nwdc_course',
					'test_nwdc_segment',
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// The planner's student_schedule_segment scopes its cache on its
				// discipline and keeps no revisions; its `name` is unique, its
				// `label` what a takeover updates. Its junction to student_course
				// scopes on the course it links.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: 'test_nwdc_course',
							primaryKeyType: 'string',
							meta: { accountability: null },
						},
						{
							collection: 'test_nwdc_course_segment',
							primaryKeyType: 'string',
							meta: {
								scoped_cache_fields: ['course'],
								accountability: null,
							},
						},
						{
							collection: 'test_nwdc_segment',
							meta: {
								scoped_cache_fields: ['discipline'],
								accountability: null,
							},
							fields: [
								{
									field: 'name',
									type: 'string',
									meta: {},
									schema: { is_unique: true },
								},
								{ field: 'discipline', type: 'string', meta: {} },
								{ field: 'label', type: 'string', meta: {} },
							],
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: 'test_nwdc_course',
					field: 'segments',
					primaryKeyType: 'string',
					otherCollection: 'test_nwdc_course_segment',
					otherField: 'course',
				});

				await CreateFieldM2O(vendor, {
					collection: 'test_nwdc_course_segment',
					field: 'segment',
					otherCollection: 'test_nwdc_segment',
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
