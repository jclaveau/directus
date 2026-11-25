import type { MergeCoreCollection } from '../index.js';
import type { DirectusRoleMember } from './role-member.js';
import type { DirectusAccess } from './access.js';

export type DirectusRole<Schema = any> = MergeCoreCollection<
	Schema,
	'directus_roles',
	{
		id: string;
		name: string;
		icon: string;
		description: string | null;
		parent: string | DirectusRole<Schema>;
		children: string[] | DirectusRole<Schema>[];
		policies: string[] | DirectusAccess<Schema>[];
		users: string[] | DirectusRoleMember<Schema>[];
	}
>;
