import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const NOTES = 'role_change_notes';

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-change-session.feature',
	{
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, { collection: NOTES });
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: NOTES });
		},
	},
);
