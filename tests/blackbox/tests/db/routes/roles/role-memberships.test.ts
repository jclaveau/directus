import {
	CreateCollection,
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-memberships.feature',
	{
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, {
				collection: 'membership_notes',
			});

			await CreateCollection(vendor, {
				collection: 'membership_notes',
				fields: [{ field: 'label', type: 'string', meta: {} }],
			});
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: 'membership_notes' });
		},
	},
);
