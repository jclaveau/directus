export type ShareScope = {
	collection: string;
	item: string;
};

export type Accountability = {
	role: string | null;
	/**
	 * The roles the user is a member of, as stored, by sort: no ancestors.
	 */
	memberRoles: string[];
	/**
	 * The member roles and every ancestor of each.
	 */
	roles: string[];
	user: string | null;
	admin: boolean;
	app: boolean;
	share?: string;
	ip: string | null;
	userAgent?: string;
	origin?: string;
	session?: string;
	/**
	 * DB connections the user's policies grant; the highest-priority one is used.
	 */
	grantedDbConnections?: string[];
};
