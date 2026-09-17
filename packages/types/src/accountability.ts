export type ShareScope = {
	collection: string;
	item: string;
};

export type Accountability = {
	role: string | null;
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
	 * The user really acting when this accountability is someone else's
	 * (`user` is the target); undefined outside an impersonation.
	 */
	impersonator?: string;
	/**
	 * DB connections the user's policies grant; the highest-priority one is used.
	 */
	grantedDbConnections?: string[];
};
