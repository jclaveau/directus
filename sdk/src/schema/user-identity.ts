import type { MergeCoreCollection } from '../index.js';
import type { DirectusUser } from './user.js';

/**
 * directus_user_identities type
 */
export type DirectusUserIdentity<Schema = any> = MergeCoreCollection<
	Schema,
	'directus_user_identities',
	{
		id: string; // uuid
		user: DirectusUser<Schema> | string;
		/** `email`, or the name of the auth provider that vouches for `value` */
		kind: string;
		value: string;
		verified: boolean;
		auth_data: Record<string, any> | null;
		user_info: Record<string, unknown> | null;
		scope: string | null;
	}
>;
