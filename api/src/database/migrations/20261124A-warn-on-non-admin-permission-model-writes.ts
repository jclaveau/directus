import type { Knex } from 'knex';
import { useLogger } from '../../logger/index.js';

const MODEL_COLLECTIONS = [
	'directus_access',
	'directus_permissions',
	'directus_policies',
];

const MODEL_FIELDS: Record<string, string> = {
	directus_roles: 'parent',
	directus_users: 'role',
};

type PermissionRow = {
	id: number;
	collection: string;
	action: string;
	fields: string | null;
	policy: string;
	policy_name: string;
};

/**
 * Changes nothing: names each permission a non-admin policy holds on the
 * permission model, which non-admins are refused from now on (#763).
 */
export async function up(knex: Knex): Promise<void> {
	const migrationLogger = useLogger();

	const permissionRows: PermissionRow[] = await knex
		.select(
			'directus_permissions.id',
			'directus_permissions.collection',
			'directus_permissions.action',
			'directus_permissions.fields',
			'directus_permissions.policy',
			'directus_policies.name as policy_name',
		)
		.from('directus_permissions')
		.join(
			'directus_policies',
			'directus_policies.id',
			'directus_permissions.policy',
		)
		.where('directus_policies.admin_access', false)
		.whereIn('directus_permissions.action', ['create', 'update', 'delete'])
		.whereIn('directus_permissions.collection', [
			...MODEL_COLLECTIONS,
			...Object.keys(MODEL_FIELDS),
		])
		.orderBy('directus_permissions.id');

	for (const permissionRow of permissionRows) {
		const { id, collection, action, fields } = permissionRow;
		const modelField = MODEL_FIELDS[collection];
		const grantedFields = (fields ?? '').split(',');
		let refusedName = collection;

		if (modelField !== undefined) {
			const isFieldRefused = action !== 'delete'
				&& (grantedFields.includes('*') || grantedFields.includes(modelField));

			if (!isFieldRefused) {
				continue;
			}

			refusedName = `${collection}.${modelField}`;
		}

		migrationLogger.warn(
			`Permission ${id} of policy`
			+ ` ${JSON.stringify(permissionRow.policy_name)}`
			+ ` (${permissionRow.policy}): ${action}`
			+ ` on ${refusedName} is refused to non-admins from now on`,
		);
	}
}

export async function down(): Promise<void> {}
