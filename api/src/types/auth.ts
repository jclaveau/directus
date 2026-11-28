import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';

export interface AuthDriverOptions {
	knex: Knex;
	schema: SchemaOverview;
}

export interface UserIdentity {
	id: string;
	user: string;
	/** `email`, or the name of the auth provider that vouches for `value` */
	kind: string;
	value: string;
	verified: boolean;
	auth_data: string | Record<string, unknown> | null;
	user_info: string | Record<string, unknown> | null;
	scope: string | null;
}

export interface User {
	id: string;
	first_name: string | null;
	last_name: string | null;
	password: string | null;
	status: 'active' | 'suspended' | 'invited';
	role: string | null;
	primary_identity: string | null;
	/** The identity the login, or the session, was made with */
	identity: UserIdentity | null;
	app_access: boolean;
	admin_access: boolean;
}

export interface IdentityLookupOptions {
	/** The account a logged-in user links the identity to, from their session */
	linkUser: string | null;
}

export type AuthData = Record<string, any> | null;

export interface Session {
	token: string;
	expires: Date;
	share: string;
}

export type DirectusTokenPayload = {
	id?: string;
	role: string | null;
	session?: string;
	app_access: boolean | number;
	admin_access: boolean | number;
	share?: string;
};

export type ShareData = {
	share_id: string;
	share_start: Date;
	share_end: Date;
	share_times_used: number;
	share_max_uses?: number;
	share_password?: string;
};

export type AuthenticationMode = 'json' | 'cookie' | 'session';
