import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const NOTES = 'clear_notes';

defineSingularWriteFeature(
	'./tests/db/routes/permissions/permission-delete-read.feature',
	{
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, { collection: NOTES });
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: NOTES });
		},
	},
);
