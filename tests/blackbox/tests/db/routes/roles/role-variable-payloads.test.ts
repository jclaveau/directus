import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const NOTES = 'role_var_notes';

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-variable-payloads.feature',
	{
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, { collection: NOTES });
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: NOTES });
		},
	},
);
