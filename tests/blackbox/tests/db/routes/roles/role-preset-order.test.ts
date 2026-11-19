import {
	CreateCollection,
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-preset-order.feature',
	{
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, {
				collection: 'role_order_notes',
			});

			await CreateCollection(vendor, {
				collection: 'role_order_notes',
				fields: [
					{ field: 'visibility', type: 'string', meta: {} },
					{ field: 'lang', type: 'string', meta: {} },
				],
			});
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: 'role_order_notes' });
		},
	},
);
