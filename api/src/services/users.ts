import { useEnv } from '@directus/env';
import { ForbiddenError, InvalidPayloadError, RecordNotUniqueError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	ActionEventParams,
	Item,
	MutationOptions,
	PrimaryKey,
	RegisterUserInput,
	UpdateGroup,
	User,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { getSimpleHash, toArray, validatePayload } from '@directus/utils';
import { FailedValidationError, joiValidationErrorItemToErrorExtensions } from '@directus/validation';
import Joi from 'joi';
import type { Knex } from 'knex';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { performance } from 'node:perf_hooks';
import { clearCachesAfterCommit } from '../utils/clear-caches-after-commit.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { useLogger } from '../logger/index.js';
import { validateRemainingAdminUsers } from '../permissions/modules/validate-remaining-admin/validate-remaining-admin-users.js';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { getSecret } from '../utils/get-secret.js';
import isUrlAllowed from '../utils/is-url-allowed.js';
import { verifyJWT } from '../utils/jwt.js';
import { chunk, isEmpty } from '../utils/lodash-es-used.js';
import { stall } from '../utils/stall.js';
import { transactionHoldingActions } from '../utils/transaction-holding-actions.js';
import { Url } from '../utils/url.js';
import { ItemsService } from './items.js';
import {
	EMAIL_IDENTITY_KIND,
	fetchIdentity,
	fetchPasswordLoginIdentity,
	fetchUserEmail,
	IDENTITIES_COLLECTION,
	toIdentityKind,
} from '../auth/utils/user-identities.js';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import { transaction } from '../utils/transaction.js';
import { MailService } from './mail/index.js';
import { SettingsService } from './settings.js';

const env = useEnv();
const logger = useLogger();

type IdentityKeys = {
	email: string | undefined;
	provider: string | undefined;
	externalIdentifier: string | undefined;
	authData: unknown;
};

// Bounds the bind parameters of one update and the rows one cache snapshot holds.
const UNLINK_CHUNK_SIZE = 10_000;

export class UsersService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_users', options);

		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}

	/**
	 * User email has to be unique case-insensitive. This is an additional check to make sure that
	 * the email is unique regardless of casing
	 */
	private async checkUniqueEmails(
		emails: string[],
		excludeKeys: PrimaryKey[] = [],
	): Promise<void> {
		emails = emails.map((email) => email.toLowerCase());

		const duplicates = emails.filter((value, index, array) => array.indexOf(value) !== index);

		if (duplicates.length) {
			throw new RecordNotUniqueError({
				collection: IDENTITIES_COLLECTION,
				field: 'value',
				value: '[' + String(duplicates) + ']',
			});
		}

		const query = this.knex
			.select('value')
			.from(IDENTITIES_COLLECTION)
			.where('kind', EMAIL_IDENTITY_KIND)
			.whereRaw(`LOWER(??) IN (${emails.map(() => '?')})`, ['value', ...emails]);

		if (excludeKeys.length > 0) {
			query.whereNotIn('user', excludeKeys);
		}

		const results = await query;

		if (results.length) {
			throw new RecordNotUniqueError({
				collection: IDENTITIES_COLLECTION,
				field: 'value',
				value: '[' + String(emails) + ']',
			});
		}
	}

	/**
	 * Check if the provided password matches the strictness as configured in
	 * directus_settings.auth_password_policy
	 */
	private async checkPasswordPolicy(passwords: string[]): Promise<void> {
		const settingsService = new SettingsService({
			schema: this.schema,
			knex: this.knex,
		});

		const { auth_password_policy: policyRegExString } = await settingsService.readSingleton({
			fields: ['auth_password_policy'],
		});

		if (!policyRegExString) {
			return;
		}

		const wrapped = policyRegExString.startsWith('/') && policyRegExString.endsWith('/');
		const regex = new RegExp(wrapped ? policyRegExString.slice(1, -1) : policyRegExString);

		for (const password of passwords) {
			if (!regex.test(password)) {
				throw new FailedValidationError(
					joiValidationErrorItemToErrorExtensions({
						message: `Provided password doesn't match password policy`,
						path: ['password'],
						type: 'custom.pattern.base',
						context: {
							value: password,
						},
					}),
				);
			}
		}
	}

	/**
	 * Clear users' sessions to log them out
	 */
	private async clearUserSessions(userKeys: PrimaryKey[], excludeSession?: string): Promise<void> {
		if (excludeSession) {
			await this.knex
				.from('directus_sessions')
				.whereIn('user', userKeys)
				.andWhereNot('token', '=', excludeSession)
				.delete();
		} else {
			await this.knex.from('directus_sessions').whereIn('user', userKeys).delete();
		}
	}

	/**
	 * Get basic information of user identified by email
	 */
	private async getUserByEmail(
		email: string,
		identityLookup: 'any' | 'password-login' = 'any',
	): Promise<{ id: string; role: string; status: string; password: string; email: string } | undefined> {
		const identity = identityLookup === 'any'
			? await fetchIdentity(this.knex, EMAIL_IDENTITY_KIND, email)
			: await fetchPasswordLoginIdentity(this.knex, email);

		if (!identity) {
			return undefined;
		}

		const user = await this.knex
			.select('id', 'role', 'status', 'password')
			.from('directus_users')
			.where('id', identity.user)
			.first();

		return user
? { ...user, email: identity.value }
: undefined;
	}

	/**
	 * The identity keys a users payload carries in their pre-identity shape:
	 * `email` lands as an email identity, `provider` + `external_identifier`
	 * as an SSO identity, `auth_data` on it.
	 *
	 * @throws InvalidPayloadError when a non-admin writes one, or `provider`
	 * comes without `external_identifier`
	 */
	private takeIdentityKeys(
		data: Partial<Item>,
		isUpdate: boolean,
	): IdentityKeys | null {
		const identityKeys: IdentityKeys = {
			email: data['email'] ?? undefined,
			provider: data['provider'] ?? undefined,
			externalIdentifier: data['external_identifier'] ?? undefined,
			authData: data['auth_data'] ?? null,
		};

		const isWritten = ['email', 'provider', 'external_identifier', 'auth_data']
			.some((identityKey) => identityKey in data);

		delete data['email'];
		delete data['provider'];
		delete data['external_identifier'];
		delete data['auth_data'];

		if (!isWritten) {
			return null;
		}

		const isPrivileged = !this.accountability || this.accountability.admin === true;

		for (const [payloadKey, payloadValue] of [
			['provider', identityKeys.provider],
			['external_identifier', identityKeys.externalIdentifier],
		] as const) {
			if (payloadValue !== undefined && !isPrivileged) {
				throw new InvalidPayloadError({
					reason: `You can't change the ${JSON.stringify(payloadKey)} value`
						+ ' manually',
				});
			}
		}

		// OPEN(#772): a non-admin adds an email through a verification flow, not here
		if (isUpdate && identityKeys.email !== undefined && !isPrivileged) {
			throw new InvalidPayloadError({
				reason: `You can't change the "email" value manually`,
			});
		}

		const isDefaultProvider = identityKeys.provider === undefined
			|| identityKeys.provider === DEFAULT_AUTH_PROVIDER;

		if (!isDefaultProvider && identityKeys.externalIdentifier === undefined) {
			throw new InvalidPayloadError({
				reason: `The provider ${JSON.stringify(identityKeys.provider)} needs an`
					+ ' "external_identifier"',
			});
		}

		// OPEN(#772): refused, not written onto the account's SSO identity
		if (isDefaultProvider && identityKeys.externalIdentifier !== undefined) {
			throw new InvalidPayloadError({
				reason: 'An "external_identifier" needs a provider other than'
					+ ` ${JSON.stringify(DEFAULT_AUTH_PROVIDER)}`,
			});
		}

		return identityKeys;
	}

	/**
	 * Writes the identities a users payload carried, in the transaction of the
	 * users write: an email identity replaces the value of the account's email
	 * identity shown first, unverified, or is added; an SSO identity is added.
	 * The account without a primary identity gets the first written.
	 */
	private async writeIdentityKeys(
		trx: Knex,
		userId: PrimaryKey,
		identityKeys: IdentityKeys,
	): Promise<void> {
		const identitiesService = new ItemsService(IDENTITIES_COLLECTION, {
			knex: trx,
			schema: this.schema,
			accountability: null,
		});

		const writtenIds: PrimaryKey[] = [];

		if (identityKeys.email) {
			const shownEmail = await fetchUserEmail(trx, String(userId));

			const emailIdentity = shownEmail === null
				? undefined
				: await fetchIdentity(trx, EMAIL_IDENTITY_KIND, shownEmail);

			if (emailIdentity) {
				await identitiesService.updateOne(emailIdentity.id, {
					value: identityKeys.email,
					verified: false,
				});

				writtenIds.push(emailIdentity.id);
			}
			else {
				writtenIds.push(await identitiesService.createOne({
					user: userId,
					kind: EMAIL_IDENTITY_KIND,
					value: identityKeys.email,
					verified: false,
				}));
			}
		}

		const ssoKind = identityKeys.provider === undefined
			? undefined
			: toIdentityKind(identityKeys.provider);

		const isSsoIdentity = ssoKind !== undefined
			&& ssoKind !== EMAIL_IDENTITY_KIND
			&& identityKeys.externalIdentifier !== undefined;

		if (isSsoIdentity) {
			writtenIds.push(await identitiesService.createOne({
				user: userId,
				kind: ssoKind,
				value: identityKeys.externalIdentifier,
				verified: true,
				auth_data: identityKeys.authData,
			}));
		}

		if (writtenIds.length > 0) {
			await trx('directus_users')
				.update({ primary_identity: writtenIds[0] })
				.where('id', userId)
				.whereNull('primary_identity');
		}
	}

	/**
	 * Create URL for inviting users
	 */
	private inviteUrl(email: string, url: string | null): string {
		const payload = { email, scope: 'invite' };

		const token = jwt.sign(payload, getSecret(), {
			expiresIn: env['USER_INVITE_TOKEN_TTL'] as StringValue | number,
			issuer: 'directus',
		});

		return (url
			? new Url(url)
			: new Url(env['PUBLIC_URL']).addPath('admin', 'accept-invite'))
			.setQuery('token', token)
			.toString();
	}

	/**
	 * Validate array of emails. Intended to be used with create/update users
	 */
	private validateEmail(input: string | string[]) {
		const emails = Array.isArray(input) ? input : [input];

		const schema = Joi.string().email().required();

		for (const email of emails) {
			const { error } = schema.validate(email);

			if (error) {
				throw new FailedValidationError({
					field: 'email',
					type: 'email',
					path: [],
				});
			}
		}
	}

	/**
	 * Create multiple new users
	 */
	override async createMany(data: Partial<Item>[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		const emails = data
			.filter((payload) => {
				return payload['email'] !== undefined && payload['email'] !== null;
			})
			.map((payload) => payload['email']);

		const identityKeysByRow: (IdentityKeys | null)[] = [];

		try {
			for (const payload of data) {
				identityKeysByRow.push(this.takeIdentityKeys(payload, false));
			}
		}
 catch (err: any) {
			opts.preMutationError = err;
		}

		const passwords = data
			.filter((payload) => 'password' in payload && payload['password'] !== null)
			.map((payload) => payload['password']);

		const someActive = data.some((payload) => !('status' in payload) || payload['status'] === 'active');

		try {
			if (emails.length) {
				this.validateEmail(emails);
				await this.checkUniqueEmails(emails);
			}

			if (passwords.length) {
				await this.checkPasswordPolicy(passwords);
			}
		} catch (err: any) {
			opts.preMutationError = err;
		}

		if (someActive) {
			// Creating users only requires checking user limits if the users are active, no need to care about the role
			opts.userIntegrityCheckFlags =
				(opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;

			opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		}

		if (identityKeysByRow.every((identityKeys) => identityKeys === null)) {
			// Use generic ItemsService to avoid calling `UserService.createOne` to
			// avoid additional work of validating emails, as this requires one query
			// per email if done in `createOne`
			return await new ItemsService(this.collection, {
				schema: this.schema,
				accountability: this.accountability,
				knex: this.knex,
			}).createMany(data, opts);
		}

		return await transaction(this.knex, async (trx) => {
			const createdKeys = await new ItemsService(this.collection, {
				schema: this.schema,
				accountability: this.accountability,
				knex: trx,
			}).createMany(data, opts);

			for (const [rowIndex, createdKey] of createdKeys.entries()) {
				const identityKeys = identityKeysByRow[rowIndex];

				if (identityKeys) {
					await this.writeIdentityKeys(trx, createdKey, identityKeys);
				}
			}

			return createdKeys;
		});
	}

	/**
	 * Update users in groups, each group one change applied to the keys it names.
	 * Every update entrypoint funnels through here.
	 */
	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		const claimedEmails = new Set<string>();

		// A user the batch gives a new email frees its old one; claimedEmails
		// still refuses two rows claiming one.
		const rewrittenEmailKeys = groups
			.filter(({ data }) => {
				return Boolean(data['email']);
			})
			.flatMap(({ keys }) => {
				return keys;
			});

		const identityWrites: { keys: PrimaryKey[]; identityKeys: IdentityKeys }[] = [];

		for (const { data, keys } of groups) {
			try {
				const identityKeys = this.takeIdentityKeys(data, true);

				if (identityKeys) {
					identityWrites.push({ keys, identityKeys });
				}

				if (identityKeys?.email) {
					data['email'] = identityKeys.email;
				}

				if (data['email']) {
					const lowerEmail = String(data['email']).toLowerCase();

					// One email can belong to one user only, across every group.
					if (keys.length > 1 || claimedEmails.has(lowerEmail)) {
						throw new RecordNotUniqueError({
							collection: 'directus_users',
							field: 'email',
							value: data['email'],
						});
					}

					claimedEmails.add(lowerEmail);
					this.validateEmail(data['email']);
					await this.checkUniqueEmails([data['email']], rewrittenEmailKeys);
					delete data['email'];
				}

				if (data['password']) {
					await this.checkPasswordPolicy([data['password']]);
				}

				if (data['tfa_secret'] !== undefined) {
					throw new InvalidPayloadError({
						reason: `You can't change the "tfa_secret" value manually`,
					});
				}

			}
			catch (err: any) {
				opts.preMutationErrorsByKey ??= new Map();

				for (const key of keys) {
					if (!opts.preMutationErrorsByKey.has(String(key))) {
						opts.preMutationErrorsByKey.set(String(key), err);
					}
				}
			}
		}

		const updatedKeys = await super.updateGroups(groups, opts);

		// OPEN(#772): written after the users update commits, not in its transaction
		if (identityWrites.length > 0) {
			await transaction(this.knex, async (trx) => {
				for (const { keys, identityKeys } of identityWrites) {
					for (const userKey of keys) {
						await this.writeIdentityKeys(trx, userKey, identityKeys);
					}
				}
			});

			const emailRewrittenKeys = identityWrites
				.filter(({ identityKeys }) => identityKeys.email !== undefined)
				.flatMap(({ keys }) => keys);

			if (emailRewrittenKeys.length > 0) {
				await this.clearUserSessions(
					emailRewrittenKeys,
					this.accountability?.session,
				);
			}
		}

		return updatedKeys;
	}

	protected override requiredIntegrityChecks(
		groups: UpdateGroup<Item>[],
	): UserIntegrityCheckFlag {
		let integrityCheckFlags = UserIntegrityCheckFlag.None;

		for (const { data } of groups) {
			if ('role' in data) {
				integrityCheckFlags |= UserIntegrityCheckFlag.All;
			}

			if ('status' in data) {
				if (data['status'] === 'active') {
					// User are being activated, no need to check if there are enough admins
					integrityCheckFlags |= UserIntegrityCheckFlag.UserLimits;
				}
				else {
					integrityCheckFlags |= UserIntegrityCheckFlag.All;
				}
			}
		}

		return integrityCheckFlags;
	}

	protected override async applyUpdateSideEffects(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions,
	): Promise<void> {
		for (const { data, keys } of groups) {
			if (data['status'] !== undefined && data['status'] !== 'active') {
				await this.clearUserSessions(keys);
			}
			else if (data['password'] !== undefined) {
				await this.clearUserSessions(keys, this.accountability?.session);
			}
		}

		// Only clear the caches if the role has been updated
		if (groups.some(({ data }) => 'role' in data)) {
			await this.clearCaches(opts);
		}
	}

	/**
	 * Delete multiple users by primary key
	 */
	override async deleteMany(keys: PrimaryKey[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		if (opts?.onRequireUserIntegrityCheck) {
			opts.onRequireUserIntegrityCheck(opts?.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None);
		} else {
			try {
				await validateRemainingAdminUsers({ excludeUsers: keys }, { knex: this.knex, schema: this.schema });
			} catch (err: any) {
				opts.preMutationError = err;
			}
		}

		opts.mutationTracker ??= this.createMutationTracker();

		// Held until the delete's transaction ends: a hook fired inside it would read
		// the users still there, or wait on the rows it locks. Inside a caller's
		// transaction that is the caller's `bypassEmitAction`, or this call's end.
		const heldActionEvents: ActionEventParams[] = [];

		// Manual constraint, see https://github.com/directus/directus/pull/19912
		const userReferences = [
			['directus_comments', 'user_updated'],
			['directus_notifications', 'sender'],
			['directus_versions', 'user_updated'],
		] as const;

		// In the delete's transaction: a delete refused there rolls it back.
		await transactionHoldingActions(this.knex, heldActionEvents, async (trx) => {
			// Through ItemsService so the cache purges the nulled rows, without the
			// hooks, activity and revisions the raw update never had.
			if (!opts.preMutationError) {
				for (const [collection, userField] of userReferences) {
					const itemsService = new ItemsService(collection, {
						knex: trx,
						schema: this.schema,
					});

					const unlinkedKeys = await itemsService.getKeysByQuery(
						{
							filter: { [userField]: { _in: keys } },
							limit: -1,
						},
						{ emitEvents: false },
					);

					for (const keyChunk of chunk(unlinkedKeys, UNLINK_CHUNK_SIZE)) {
						await itemsService.updateMany(
							keyChunk,
							{ [userField]: null },
							{ emitEvents: false },
						);
					}
				}
			}

			await new ItemsService('directus_users', {
				knex: trx,
				schema: this.schema,
				accountability: this.accountability,
				nested: this.nested,
			}).deleteMany(keys, {
				...opts,
				bypassEmitAction: opts.bypassEmitAction ?? ((actionEvent) => {
					heldActionEvents.push(actionEvent);
				}),
			});
		}, opts.mutationTracker.snapshot());

		const emitting = Promise.all(heldActionEvents.map((actionEvent) => {
			return emitter.emitAction(
				actionEvent.event,
				actionEvent.meta,
				actionEvent.context,
			);
		}));

		if (opts.awaitActionHooks !== false) {
			await emitting;
		}

		await this.clearUserSessions(keys);

		return keys;
	}

	async inviteUser(email: string | string[], role: string, url: string | null, subject?: string | null): Promise<void> {
		const opts: MutationOptions = {};

		try {
			if (url && isUrlAllowed(url, env['USER_INVITE_URL_ALLOW_LIST']) === false) {
				throw new InvalidPayloadError({ reason: `URL "${url}" can't be used to invite users` });
			}
		} catch (err: any) {
			opts.preMutationError = err;
		}

		const emails = toArray(email);

		const mailService = new MailService({
			schema: this.schema,
			accountability: this.accountability,
		});

		for (const email of emails) {
			// Check if user is known
			const user = await this.getUserByEmail(email);

			// Create user first to verify uniqueness if unknown
			if (isEmpty(user)) {
				await this.createOne({ email, role, status: 'invited' }, opts);

				// For known users update role if changed
			} else if (user.status === 'invited' && user.role !== role) {
				await this.updateOne(user.id, { role }, opts);
			}
			else if (opts.preMutationError) {
				throw opts.preMutationError;
			}

			// Send invite for new and already invited users
			if (isEmpty(user) || user.status === 'invited') {
				const subjectLine = subject ?? "You've been invited";

				mailService
					.send({
						to: user?.email ?? email,
						subject: subjectLine,
						template: {
							name: 'user-invitation',
							data: {
								url: this.inviteUrl(user?.email ?? email, url),
								email: user?.email ?? email,
							},
						},
					})
					.catch((error) => {
						logger.error(error, `Could not send user invitation mail`);
					});
			}
		}
	}

	async acceptInvite(token: string, password: string): Promise<void> {
		const { email, scope } = verifyJWT(token, getSecret()) as {
			email: string;
			scope: string;
		};

		if (scope !== 'invite')
			throw new ForbiddenError({
				reason: 'Not an invite token',
			});

		const user = await this.getUserByEmail(email);

		if (user?.status !== 'invited') {
			throw new InvalidPayloadError({ reason: `Email address ${email} hasn't been invited` });
		}

		// Allow unauthenticated update
		const service = new UsersService({
			knex: this.knex,
			schema: this.schema,
		});

		await service.updateOne(user.id, { password, status: 'active' });
	}

	async registerUser(input: RegisterUserInput) {
		if (
			input.verification_url &&
			isUrlAllowed(
				input.verification_url,
				env['USER_REGISTER_URL_ALLOW_LIST'],
			) === false
		) {
			throw new InvalidPayloadError({
				reason: `URL "${input.verification_url}" can't be used to verify registered users`,
			});
		}

		const STALL_TIME = env['REGISTER_STALL_TIME'];
		const timeStart = performance.now();
		const serviceOptions: AbstractServiceOptions = { accountability: this.accountability, schema: this.schema };
		const settingsService = new SettingsService(serviceOptions);

		const settings = await settingsService.readSingleton({
			fields: [
				'public_registration',
				'public_registration_verify_email',
				'public_registration_role',
				'public_registration_email_filter',
			],
		});

		if (settings?.['public_registration'] == false) {
			throw new ForbiddenError({
				reason: 'Public registration is disabled',
			});
		}

		const publicRegistrationRole = settings?.['public_registration_role'] ?? null;
		const hasEmailVerification = settings?.['public_registration_verify_email'];
		const emailFilter = settings?.['public_registration_email_filter'];
		const first_name = input.first_name ?? null;
		const last_name = input.last_name ?? null;

		// `email` is written as the account's email identity
		const partialUser: Partial<User> & { email: string } = {
			// Required fields
			email: input.email,
			password: input.password,
			role: publicRegistrationRole,
			status: hasEmailVerification ? 'unverified' : 'active',
			// Optional fields
			first_name,
			last_name,
		};

		if (emailFilter && validatePayload(emailFilter, { email: input.email }).length !== 0) {
			await stall(STALL_TIME, timeStart);
			throw new ForbiddenError({
				reason: 'Invalid payload',
			});
		}

		const user = await this.getUserByEmail(input.email);

		if (isEmpty(user)) {
			await this.createOne(partialUser);
		}
		// We want to be able to re-send the verification email
		else if (user.status !== ('unverified' satisfies User['status'])) {
			// To avoid giving attackers infos about registered emails we dont fail for violated unique constraints
			await stall(STALL_TIME, timeStart);
			return;
		}

		if (hasEmailVerification) {
			const mailService = new MailService(serviceOptions);
			const payload = { email: input.email, scope: 'pending-registration' };

			const token = jwt.sign(payload, env['SECRET'] as string, {
				expiresIn: env['EMAIL_VERIFICATION_TOKEN_TTL'] as StringValue | number,
				issuer: 'directus',
			});

			const verificationUrl = (
				input.verification_url
					? new Url(input.verification_url)
					: new Url(env['PUBLIC_URL']).addPath('users', 'register', 'verify-email')
			)
				.setQuery('token', token)
				.toString();

			mailService
				.send({
					to: input.email,
					subject: 'Verify your email address', // TODO: translate after theres support for internationalized emails
					template: {
						name: 'user-registration',
						data: {
							url: verificationUrl,
							email: input.email,
							first_name,
							last_name,
						},
					},
				})
				.catch((error) => {
					logger.error(error, 'Could not send email verification mail');
				});
		}

		await stall(STALL_TIME, timeStart);
	}

	async verifyRegistration(token: string): Promise<string> {
		const { email, scope } = verifyJWT(token, env['SECRET'] as string) as {
			email: string;
			scope: string;
		};

		if (scope !== 'pending-registration')
			throw new ForbiddenError({
				reason: 'Not a pending registration token',
			});

		const user = await this.getUserByEmail(email);

		if (user?.status !== ('unverified' satisfies User['status'])) {
			throw new InvalidPayloadError({ reason: 'Invalid verification code' });
		}

		await this.updateOne(user.id, { status: 'active' });

		return user.id;
	}

	async requestPasswordReset(email: string, url: string | null, subject?: string | null): Promise<void> {
		const STALL_TIME = 500;
		const timeStart = performance.now();

		const user = await this.getUserByEmail(email, 'password-login');

		if (user?.status !== 'active') {
			await stall(STALL_TIME, timeStart);
			throw new ForbiddenError({
				reason: 'Inactive user',
			});
		}

		// Point 10: a first password is set from a logged-in session only, so an
		// account the IdP offboards stays locked out
		if (!user.password) {
			await stall(STALL_TIME, timeStart);
			throw new ForbiddenError({
				reason: 'No password is set on this account',
			});
		}

		if (url && isUrlAllowed(url, env['PASSWORD_RESET_URL_ALLOW_LIST']) === false) {
			throw new InvalidPayloadError({ reason: `URL "${url}" can't be used to reset passwords` });
		}

		const mailService = new MailService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		const payload = { email: user.email, scope: 'password-reset', hash: getSimpleHash('' + user.password) };
		const token = jwt.sign(payload, getSecret(), { expiresIn: '1d', issuer: 'directus' });

		const acceptUrl = (url
			? new Url(url)
			: new Url(env['PUBLIC_URL']).addPath('admin', 'reset-password'))
			.setQuery('token', token)
			.toString();

		const subjectLine = subject ? subject : 'Password Reset Request';

		mailService
			.send({
				to: user.email,
				subject: subjectLine,
				template: {
					name: 'password-reset',
					data: {
						url: acceptUrl,
						email: user.email,
					},
				},
			})
			.catch((error) => {
				logger.error(error, `Could not send password reset mail`);
			});

		await stall(STALL_TIME, timeStart);
	}

	async resetPassword(token: string, password: string): Promise<void> {
		const { email, scope, hash } = verifyJWT(token, getSecret()) as {
			email: string;
			scope: string;
			hash: string;
		};

		if (scope !== 'password-reset' || !hash)
			throw new ForbiddenError({
				reason: 'Not a password reset token',
			});

		const opts: MutationOptions = {};

		try {
			await this.checkPasswordPolicy([password]);
		} catch (err: any) {
			opts.preMutationError = err;
		}

		const user = await this.getUserByEmail(email, 'password-login');

		if (user?.status !== 'active') {
			throw new ForbiddenError({
				reason: 'Inactive user',
			});
		}

		if (!user.password) {
			throw new ForbiddenError({
				reason: 'No password is set on this account',
			});
		}

		if (hash !== getSimpleHash('' + user.password)) {
			throw new ForbiddenError({
				reason: 'Bad user credentials',
			});
		}

		// Allow unauthenticated update
		const service = new UsersService({
			knex: this.knex,
			schema: this.schema,
			accountability: {
				...(this.accountability ?? createDefaultAccountability()),
				admin: true, // We need to skip permissions checks for the update call below
			},
		});

		await service.updateOne(user.id, { password, status: 'active' }, opts);
	}

	/**
	 * Point 4: removes one of the account's identities and the sessions it
	 * opened. The primary moves to a verified email, else any email, else any
	 * identity left.
	 *
	 * @throws ForbiddenError when the identity isn't the account's
	 * @throws InvalidPayloadError when it is the account's last identity
	 */
	async removeIdentity(userId: string, identityId: string): Promise<void> {
		await transaction(this.knex, async (trx) => {
			type OwnedIdentity = { id: string; kind: string; verified: boolean };

			const userIdentities: OwnedIdentity[] = await trx
				.select('id', 'kind', 'verified')
				.from(IDENTITIES_COLLECTION)
				.where('user', userId)
				.forUpdate();

			if (!userIdentities.some((userIdentity) => userIdentity.id === identityId)) {
				throw new ForbiddenError({
					reason: `The identity ${JSON.stringify(identityId)} isn't one of the`
						+ ' account\'s',
				});
			}

			if (userIdentities.length === 1) {
				throw new InvalidPayloadError({
					reason: `The identity ${JSON.stringify(identityId)} is the account's`
						+ ' last identity',
				});
			}

			const remainingIdentities = userIdentities
				.filter((userIdentity) => userIdentity.id !== identityId);

			// OPEN(#772): the primary that replaces a removed one
			const nextPrimary = remainingIdentities.find((userIdentity) => {
				return userIdentity.kind === EMAIL_IDENTITY_KIND && userIdentity.verified;
			})
				?? remainingIdentities.find((userIdentity) => {
					return userIdentity.kind === EMAIL_IDENTITY_KIND;
				})
				?? remainingIdentities[0]!;

			await trx('directus_users')
				.update({ primary_identity: nextPrimary.id })
				.where('id', userId)
				.where('primary_identity', identityId);

			await new ItemsService(IDENTITIES_COLLECTION, {
				knex: trx,
				schema: this.schema,
				accountability: null,
			}).deleteOne(identityId);
		});
	}

	private async clearCaches(opts?: MutationOptions) {
		await clearCachesAfterCommit(this.knex, this.cache, opts);
	}
}
