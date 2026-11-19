import type { MergeCoreCollection } from '../index.js';
import type { DirectusRole } from './role.js';
import type { DirectusUser } from './user.js';

export type DirectusRoleMember<Schema = any> = MergeCoreCollection<
	Schema,
	'directus_role_members',
	{
		id: string; // uuid
		user: string | DirectusUser<Schema>;
		role: string | DirectusRole<Schema>;
		sort: number | null;
		managed_by: string | null;
	}
>;
