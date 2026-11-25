import { Role, RoleMembership, User } from '@directus/types';

export type ShareUser = {
	share: string;
	admin_access: boolean;
	app_access: boolean;
};

export type AppUser = Omit<User, 'roles'> & {
	admin_access: boolean;
	app_access: boolean;
	enforce_tfa: boolean;
	/** The roles the user is a member of: `role` is the relation inside */
	roles: RoleMembership[];
	/** The member roles and every ancestor of each, from /roles/me */
	effectiveRoles: Role[];
};
