export interface Policy {
	id: string;
	name: string;
	icon: string;
	description: string | null;
	enforce_tfa: null | boolean;
	ip_access: string[] | null;
	app_access: boolean;
	admin_access: boolean;
	db_connections: string[] | null;
}

export interface Globals {
	enforce_tfa: boolean;
	app_access: boolean;
	admin_access: boolean;
}
