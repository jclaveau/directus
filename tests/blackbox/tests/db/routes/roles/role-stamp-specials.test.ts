import {
	CreateCollection,
	DeleteCollection,
	DeleteCollectionIfPresent,
	type FoldedField,
} from '@common/functions';
import { defineSingularWriteFeature } from '../system/singular-write-steps';

const LABEL_FIELD: FoldedField = { field: 'label', type: 'string', meta: {} };

const STATUS_FIELD: FoldedField = { field: 'status', type: 'string', meta: {} };

const CREATED_ROLES_FIELD: FoldedField = {
	field: 'created_roles',
	type: 'json',
	meta: { special: ['cast-json', 'roles-created'] },
};

const UPDATED_ROLES_FIELD: FoldedField = {
	field: 'updated_roles',
	type: 'json',
	meta: { special: ['cast-json', 'roles-updated'] },
};

// A Given seeds the rows of the last three under keys of its own.
const STAMP_COLLECTIONS = [
	{
		collection: 'stamp_inherited_notes',
		fields: [LABEL_FIELD, CREATED_ROLES_FIELD],
	},
	{
		collection: 'stamp_direct_notes',
		fields: [LABEL_FIELD, CREATED_ROLES_FIELD],
	},
	{
		collection: 'stamp_admin_notes',
		fields: [LABEL_FIELD, CREATED_ROLES_FIELD],
	},
	{
		collection: 'stamp_refused_notes',
		fields: [LABEL_FIELD],
	},
	{
		collection: 'stamp_reviewed_notes',
		fields: [LABEL_FIELD, STATUS_FIELD, UPDATED_ROLES_FIELD],
		primaryKeyType: 'uuid' as const,
	},
	{
		collection: 'stamp_split_notes',
		fields: [LABEL_FIELD, STATUS_FIELD, UPDATED_ROLES_FIELD],
		primaryKeyType: 'uuid' as const,
	},
	{
		collection: 'stamp_field_notes',
		fields: [
			LABEL_FIELD,
			{ field: 'note', type: 'string', meta: {} },
			UPDATED_ROLES_FIELD,
		],
		primaryKeyType: 'uuid' as const,
	},
];

defineSingularWriteFeature(
	'./tests/db/routes/roles/role-stamp-specials.feature',
	{
		async beforeFeature(vendor) {
			for (const stampCollection of STAMP_COLLECTIONS) {
				await DeleteCollectionIfPresent(vendor, {
					collection: stampCollection.collection,
				});

				await CreateCollection(vendor, stampCollection);
			}
		},
		async afterFeature(vendor) {
			for (const { collection } of STAMP_COLLECTIONS) {
				await DeleteCollection(vendor, { collection });
			}
		},
	},
);
