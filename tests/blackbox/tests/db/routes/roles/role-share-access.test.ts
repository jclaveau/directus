import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const NOTES = 'role_share_notes';

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-share-access.feature',
	{
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, { collection: NOTES });
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: NOTES });
		},
	},
);
