import { InvalidCredentialsError } from '@directus/errors';
import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import type {
	AuthDriverOptions,
	IdentityLookupOptions,
	User,
	UserIdentity,
} from '../types/index.js';
import { IDENTITIES_COLLECTION, toIdentityKind } from './utils/user-identities.js';

export abstract class AuthDriver {
	knex: Knex;
	schema: SchemaOverview;
	/** The `kind` of the identities this provider logs in with */
	identityKind: string;

	constructor(options: AuthDriverOptions, config: Record<string, any>) {
		this.knex = options.knex;
		this.schema = options.schema;
		this.identityKind = toIdentityKind(config['provider'] ?? DEFAULT_AUTH_PROVIDER);
	}

	/**
	 * Get the identity a provider payload logs in with
	 *
	 * A driver that only implements `getUserID` logs in with the user's identity
	 * of this provider's kind.
	 *
	 * @throws InvalidCredentialsError
	 */
	async getIdentity(
		payload: Record<string, any>,
		_options: IdentityLookupOptions,
	): Promise<UserIdentity> {
		const userId = await this.getUserID(payload);

		// OPEN(#772): a driver that never wrote an identity row cannot log in
		const identity = await this.knex
			.select<UserIdentity>('*')
			.from(IDENTITIES_COLLECTION)
			.where({ user: userId, kind: this.identityKind })
			.first();

		if (!identity) {
			throw new InvalidCredentialsError();
		}

		return identity;
	}

	/**
	 * Get user id for a given provider payload
	 *
	 * @param payload Any data that the user might've provided
	 * @throws InvalidCredentialsError
	 * @return User id of the identifier
	 */
	abstract getUserID(payload: Record<string, any>): Promise<string>;

	/**
	 * Verify user password
	 *
	 * @param user User information
	 * @param password User password
	 * @throws InvalidCredentialsError
	 */
	abstract verify(user: User, password?: string): Promise<void>;

	/**
	 * Check with the (external) provider if the user is allowed entry to Directus
	 *
	 * @param _user User information
	 * @param _payload Any data that the user might've provided
	 * @throws InvalidCredentialsError
	 * @returns Data to be stored with the session
	 */
	async login(_user: User, _payload: Record<string, any>): Promise<void> {
		return;
	}

	/**
	 * Handle user session refresh
	 *
	 * @param _user User information
	 * @throws InvalidCredentialsError
	 */
	async refresh(_user: User): Promise<void> {
		return;
	}

	/**
	 * Handle user session termination
	 *
	 * @param _user User information
	 */
	async logout(_user: User): Promise<void> {
		return;
	}
}
