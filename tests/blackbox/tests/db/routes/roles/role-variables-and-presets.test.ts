import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const COLLECTIONS = ['role_preset_notes', 'role_variable_notes'];

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-variables-and-presets.feature',
	{
		async beforeFeature(vendor) {
			for (const collection of COLLECTIONS) {
				await DeleteCollectionIfPresent(vendor, { collection });
			}
		},
		async afterFeature(vendor) {
			for (const collection of COLLECTIONS) {
				await DeleteCollection(vendor, { collection });
			}
		},
	},
);
