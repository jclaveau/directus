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
	/** Names of the DB connections the user's policies grant; routing picks the highest-priority one. */
	dbConnections?: string[];
};
