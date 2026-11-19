import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const NOTES_COLLECTIONS = ['role_share_notes', 'role_share_refresh_notes'];

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-share-access.feature',
	{
		async beforeFeature(vendor) {
			for (const collection of NOTES_COLLECTIONS) {
				await DeleteCollectionIfPresent(vendor, { collection });
			}
		},
		async afterFeature(vendor) {
			for (const collection of NOTES_COLLECTIONS) {
				await DeleteCollection(vendor, { collection });
			}
		},
	},
);
