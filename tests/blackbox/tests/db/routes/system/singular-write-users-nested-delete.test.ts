import {
	CreateCollection,
	CreateFieldO2M,
	DeleteCollection,
	DeleteCollectionIfPresent,
	DeleteField,
	DeleteFieldIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from './singular-write-steps';

const TEAM_COLLECTION = 'test_sw_user_teams';

const TEAM_FIELD = 'sw_user_team';

defineSingularWriteFeature(
	'./tests/db/routes/system/singular-write-users-nested-delete.feature',
	{
		async beforeFeature(vendor) {
			await DeleteFieldIfPresent(vendor, {
				collection: 'directus_users',
				field: TEAM_FIELD,
			});

			await DeleteCollectionIfPresent(vendor, { collection: TEAM_COLLECTION });
			await CreateCollection(vendor, { collection: TEAM_COLLECTION });

			await CreateFieldO2M(vendor, {
				collection: TEAM_COLLECTION,
				field: 'members',
				otherCollection: 'directus_users',
				otherField: TEAM_FIELD,
				relationMeta: { one_deselect_action: 'delete' },
			});
		},
		async afterFeature(vendor) {
			await DeleteField(vendor, {
				collection: 'directus_users',
				field: TEAM_FIELD,
			});

			await DeleteCollection(vendor, { collection: TEAM_COLLECTION });
		},
	},
);
