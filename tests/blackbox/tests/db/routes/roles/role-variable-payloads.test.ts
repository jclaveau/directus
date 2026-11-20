import {
	CreateCollection,
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

			await CreateCollection(vendor, {
				collection: NOTES,
				fields: [{ field: 'label', type: 'string', meta: {} }],
			});
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: NOTES });
		},
	},
);
