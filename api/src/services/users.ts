import { useEnv } from '@directus/env';
import { ForbiddenError, InvalidPayloadError, RecordNotUniqueError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	Accountability,
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
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import type { StringValue } from 'ms';
import { performance } from 'node:perf_hooks';
import {
	clearPermissionsCacheAfterCommit,
} from '../utils/clear-caches-after-commit.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { useLogger } from '../logger/index.js';
import { validateRemainingAdminUsers } from '../permissions/modules/validate-remaining-admin/validate-remaining-admin-users.js';
import { fetchPolicies } from '../permissions/lib/fetch-policies.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
// eslint-disable-next-line max-len
import { fetchGlobalAccessForRoles } from '../permissions/modules/fetch-global-access/lib/fetch-global-access-for-roles.js';
import {
	processPayload,
} from '../permissions/modules/process-payload/process-payload.js';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { getSecret } from '../utils/get-secret.js';
import isUrlAllowed from '../utils/is-url-allowed.js';
import { verifyJWT } from '../utils/jwt.js';
import { transaction } from '../utils/transaction.js';
import { chunk, isEmpty } from '../utils/lodash-es-used.js';
import { stall } from '../utils/stall.js';
import { transactionHoldingActions } from '../utils/transaction-holding-actions.js';
import { Url } from '../utils/url.js';
import { InvitesService } from './invites.js';
import { ItemsService } from './items.js';
import { MailService } from './mail/index.js';
import { RoleMembersService } from './role-members.js';
import { SettingsService } from './settings.js';

const env = useEnv();
const logger = useLogger();

/** D1 of #746: no sugar replacing every membership by one role. */
class SingleRoleFieldError extends InvalidPayloadError {
	constructor() {
		super({
			reason: '"role" is replaced by the memberships in "roles":'
				+ ' send "roles": [{ "role": <role id> }]',
		});
	}
}

// Bounds the bind parameters of one update and the rows one cache snapshot holds.
const UNLINK_CHUNK_SIZE = 10_000;

class UnheldPolicyInviteError extends InvalidPayloadError {
	constructor(roleName: string, policyName: string) {
		super({
			reason: `You can't invite into role ${JSON.stringify(roleName)}: it grants`
				+ ` policy ${JSON.stringify(policyName)} you don't hold`,
		});
	}
}

class AdminRoleInviteError extends InvalidPayloadError {
	constructor(invitedRole: string) {
		super({
			reason: `Role ${JSON.stringify(invitedRole)} gives admin access,`
				+ ' which an invite can\'t give: add the membership once the user'
				+ ' accepted',
		});
	}
}

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
				collection: 'directus_users',
				field: 'email',
				value: '[' + String(duplicates) + ']',
			});
		}

		const query = this.knex
			.select('email')
			.from('directus_users')
			.whereRaw(`LOWER(??) IN (${emails.map(() => '?')})`, ['email', ...emails]);

		if (excludeKeys.length > 0) {
			query.whereNotIn('id', excludeKeys);
		}

		const results = await query;

		if (results.length) {
			throw new RecordNotUniqueError({
				collection: 'directus_users',
				field: 'email',
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
	): Promise<
		{ id: string; status: string; password: string; email: string } | undefined
	> {
		return this.knex
			.select('id', 'status', 'password', 'email')
			.from('directus_users')
			.whereRaw(`LOWER(??) = ?`, ['email', email.toLowerCase()])
			.first();
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

		return (url ? new Url(url) : new Url(env['PUBLIC_URL'] as string).addPath('admin', 'accept-invite'))
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
			.filter((payload) => payload['email'] !== undefined)
			.map((payload) => payload['email']);

		const passwords = data
			.filter((payload) => 'password' in payload && payload['password'] !== null)
			.map((payload) => payload['password']);

		const someActive = data.some((payload) => !('status' in payload) || payload['status'] === 'active');

		try {
			if (data.some((payload) => 'role' in payload)) {
				throw new SingleRoleFieldError();
			}

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

		// Use generic ItemsService to avoid calling `UserService.createOne` to avoid additional work of validating emails,
		// as this requires one query per email if done in `createOne`
		const itemsService = new ItemsService(this.collection, {
			schema: this.schema,
			accountability: this.accountability,
			knex: this.knex,
		});

		// The users' memberships are created in the same write: no cache holds them.
		return await itemsService.createMany(data, {
			...opts,
			createsNewUserMemberships: true,
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

		for (const { data, keys } of groups) {
			try {
				if ('role' in data) {
					throw new SingleRoleFieldError();
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
				}

				if (data['password']) {
					await this.checkPasswordPolicy([data['password']]);
				}

				if (data['tfa_secret'] !== undefined) {
					throw new InvalidPayloadError({
						reason: `You can't change the "tfa_secret" value manually`,
					});
				}

				if (data['provider'] !== undefined) {
					if (this.accountability && this.accountability.admin !== true) {
						throw new InvalidPayloadError({
							reason: `You can't change the "provider" value manually`,
						});
					}

					data['auth_data'] = null;
				}

				if (data['external_identifier'] !== undefined) {
					if (this.accountability && this.accountability.admin !== true) {
						throw new InvalidPayloadError({
							reason: `You can't change the "external_identifier" value manually`,
						});
					}

					data['auth_data'] = null;
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

		return await super.updateGroups(groups, opts);
	}

	protected override requiredIntegrityChecks(
		groups: UpdateGroup<Item>[],
	): UserIntegrityCheckFlag {
		let integrityCheckFlags = UserIntegrityCheckFlag.None;

		for (const { data } of groups) {
			if ('roles' in data) {
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
		_opts: MutationOptions,
	): Promise<void> {
		for (const { data, keys } of groups) {
			if (data['status'] !== undefined && data['status'] !== 'active') {
				await this.clearUserSessions(keys);
			}
			else if (data['password'] !== undefined || data['email'] !== undefined) {
				await this.clearUserSessions(keys, this.accountability?.session);
			}
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

				await this.deleteInvitesLeftTwice(trx, keys);
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

			// The permissions cached for a deleted user's memberships, which the
			// database's cascade removes without the memberships' service.
			await clearPermissionsCacheAfterCommit(trx);
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

	/**
	 * A deleted inviter's invites keep waiting, their inviter set to null: of
	 * the invites of one email and role left with a null inviter, only the
	 * oldest stays, as the unique index counts one null inviter.
	 */
	private async deleteInvitesLeftTwice(
		trx: Knex,
		deletedUsers: PrimaryKey[],
	): Promise<void> {
		const inviteRows: { id: string; email: string; role: string }[] = await trx
			.select('id', 'email', 'role')
			.from('directus_invites')
			.whereIn('inviter', deletedUsers)
			.orWhere((noInviterQuery) => {
				noInviterQuery
					.whereNull('inviter')
					.whereIn(
						trx.raw('LOWER(??)', ['email']),
						trx.select(trx.raw('LOWER(??)', ['email']))
							.from('directus_invites')
							.whereIn('inviter', deletedUsers),
					);
			})
			.orderBy(['date_created', 'id']);

		const keptInvites = new Set<string>();

		const invitesLeftTwice = inviteRows.filter(({ email, role }) => {
			const invitedRole = JSON.stringify([email.toLowerCase(), role]);
			const isLeftTwice = keptInvites.has(invitedRole);

			keptInvites.add(invitedRole);

			return isLeftTwice;
		});

		if (invitesLeftTwice.length > 0) {
			await new InvitesService({ knex: trx, schema: this.schema })
				.deleteMany(invitesLeftTwice.map(({ id }) => id));
		}
	}

	/**
	 * An invite is a row of `directus_invites` per email, role and inviter: the
	 * inviter, or null from a service naming none (an extension, a flow).
	 * A re-invite by the same inviter replaces its own rows; one by another
	 * inviter adds its own. No user and no membership is written until the
	 * invite is accepted: the roles wait in the invites, changing no permission
	 * and no cache. Inviting the email of an account proposes it the roles.
	 *
	 * Anyone allowed to create the invite rows invites, admin or not: the
	 * permissions on `directus_invites` say which roles, and a non-admin gives
	 * no policy they don't hold. No invite gives a role reaching admin access.
	 */
	async inviteUser(
		email: string | string[],
		roles: string[],
		url: string | null,
		subject?: string | null,
	): Promise<void> {
		const opts: MutationOptions = {};

		try {
			if (url && isUrlAllowed(url, env['USER_INVITE_URL_ALLOW_LIST'] as string) === false) {
				throw new InvalidPayloadError({ reason: `URL "${url}" can't be used to invite users` });
			}
		} catch (err: any) {
			opts.preMutationError = err;
		}

		const invitedRoles = [...new Set(roles)];
		const emails = toArray(email);

		this.validateEmail(emails);
		await this.refuseAdminRoleInvites(invitedRoles);
		await this.validateInvitePermission(emails, invitedRoles);

		if (opts.preMutationError) {
			throw opts.preMutationError;
		}

		const mailService = new MailService({
			schema: this.schema,
			accountability: this.accountability,
		});

		for (const email of emails) {
			await transaction(this.knex, async (trx) => {
				await this.writeInviteRows(trx, email, invitedRoles);
			});

			mailService
				.send({
					to: email,
					subject: subject ?? "You've been invited",
					template: {
						name: 'user-invitation',
						data: {
							url: this.inviteUrl(email, url),
							email,
						},
					},
				})
				.catch((error) => {
					logger.error(error, `Could not send user invitation mail`);
				});
		}
	}

	// The rows are written as code, past the guard refusing a non-admin's
	// direct write: the inviter's permissions are checked here instead.
	private async validateInvitePermission(
		emails: string[],
		invitedRoles: string[],
	): Promise<void> {
		if (!this.accountability || this.accountability.admin === true) {
			return;
		}

		await this.refuseUnheldPolicyInvites(this.accountability, invitedRoles);

		for (const email of emails) {
			for (const role of invitedRoles) {
				await processPayload(
					{
						accountability: this.accountability,
						action: 'create',
						collection: 'directus_invites',
						payload: { email, role },
						nested: [],
					},
					{ knex: this.knex, schema: this.schema },
				);
			}
		}
	}

	// A role gives the policies attached to it or to a parent: a non-admin
	// inviter gives only those they hold, through their roles or their own.
	private async refuseUnheldPolicyInvites(
		inviterAccountability: Accountability,
		invitedRoles: string[],
	): Promise<void> {
		const heldPolicies = new Set(await fetchPolicies(
			inviterAccountability,
			{ knex: this.knex, schema: this.schema },
		));

		for (const invitedRole of invitedRoles) {
			const givenPolicies: { id: string; name: string }[] = await this.knex
				.select('directus_policies.id', 'directus_policies.name')
				.from('directus_access')
				.join('directus_policies', 'directus_policies.id', 'directus_access.policy')
				.whereIn(
					'directus_access.role',
					await fetchRolesTree(invitedRole, this.knex),
				)
				.orderBy('directus_policies.name');

			const unheldPolicy = givenPolicies.find(({ id }) => !heldPolicies.has(id));

			if (unheldPolicy === undefined) {
				continue;
			}

			const { name: roleName } = await this.knex
				.select('name')
				.from('directus_roles')
				.where({ id: invitedRole })
				.first();

			throw new UnheldPolicyInviteError(roleName, unheldPolicy.name);
		}
	}

	// A role reaches admin access through its own policies or a parent's.
	private async refuseAdminRoleInvites(invitedRoles: string[]): Promise<void> {
		for (const invitedRole of invitedRoles) {
			const { admin: grantsAdmin } = await fetchGlobalAccessForRoles(
				{ roles: await fetchRolesTree(invitedRole, this.knex), ip: null },
				this.knex,
			);

			if (grantsAdmin) {
				throw new AdminRoleInviteError(invitedRole);
			}
		}
	}

	// The invites of this inviter become `invitedRoles`; another's stay. An
	// email matches in any case, as a login does.
	private async writeInviteRows(
		trx: Knex,
		email: string,
		invitedRoles: string[],
	): Promise<void> {
		const inviter = this.accountability?.user ?? null;

		const inviterInvites: { id: string; role: string }[] = await trx
			.select('id', 'role')
			.from('directus_invites')
			.whereRaw('LOWER(??) = ?', ['email', email.toLowerCase()])
			.where((inviterQuery) => {
				if (inviter === null) {
					inviterQuery.whereNull('inviter');
				}
				else {
					inviterQuery.where('inviter', inviter);
				}
			});

		const addedRoles = invitedRoles.filter((role) => {
			return !inviterInvites.some((invite) => invite.role === role);
		});

		const droppedInvites = inviterInvites.filter(({ role }) => {
			return !invitedRoles.includes(role);
		});

		const invitesService = new InvitesService({ knex: trx, schema: this.schema });

		if (addedRoles.length > 0) {
			await invitesService.createMany(
				addedRoles.map((role) => {
					return { email, role, inviter };
				}),
				{},
			);
		}

		if (droppedInvites.length > 0) {
			await invitesService.deleteMany(droppedInvites.map(({ id }) => id));
		}
	}

	/**
	 * The invited email and its invites, oldest first; refuses a token of
	 * another scope, or of an email no longer invited.
	 */
	async readInvite(token: string): Promise<{
		email: string;
		inviteRows: { id: string; role: string }[];
	}> {
		const { email, scope } = verifyJWT(token, getSecret()) as {
			email: string;
			scope: string;
		};

		if (scope !== 'invite')
			throw new ForbiddenError({
				reason: 'Not an invite token',
			});

		const inviteRows: { id: string; role: string }[] = await this.knex
			.select('id', 'role')
			.from('directus_invites')
			.whereRaw('LOWER(??) = ?', ['email', email.toLowerCase()])
			.orderBy(['date_created', 'id']);

		if (inviteRows.length === 0) {
			throw new InvalidPayloadError({ reason: `Email address ${email} hasn't been invited` });
		}

		return { email, inviteRows };
	}

	/**
	 * A logged-in user accepts the roles into their account, sending no
	 * password. Otherwise the invite creates the account of its email, with
	 * the password sent: an invite token never sets the password of an
	 * existing account, which has to log in first.
	 */
	async acceptInvite(token: string, password?: string | null): Promise<void> {
		const { email, inviteRows } = await this.readInvite(token);
		const loggedInUser = this.accountability?.user ?? null;

		if (loggedInUser !== null && password !== undefined && password !== null) {
			throw new InvalidPayloadError({
				reason: 'A password creates a new account: log out to create the'
					+ ` account of ${JSON.stringify(email)}, or send no password to`
					+ ' add the invited roles to your account',
			});
		}

		if (loggedInUser === null && await this.getUserByEmail(email) !== undefined) {
			throw new InvalidPayloadError({
				reason: `Email address ${JSON.stringify(email)} has an account: log`
					+ ' in to it, then accept the invite',
			});
		}

		if (loggedInUser === null && (password === undefined || password === null)) {
			throw new InvalidPayloadError({
				reason: 'A password is required to create the account of'
					+ ` ${JSON.stringify(email)}`,
			});
		}

		await transaction(this.knex, async (trx) => {
			const acceptingUser = loggedInUser ?? await new UsersService({
				knex: trx,
				schema: this.schema,
			}).createOne({ email, password, status: 'active' });

			await this.grantInvitedRoles(trx, acceptingUser, inviteRows);
		});
	}

	/**
	 * The invites accepted become the user's memberships, written as code: one
	 * per role, in invite order after the roles already held, but for a role
	 * the user already holds by hand, then the invites go. The membership write
	 * clears the permissions and response caches once.
	 */
	async grantInvitedRoles(
		trx: Knex,
		acceptingUser: PrimaryKey,
		inviteRows: { id: string; role: string }[],
	): Promise<void> {
		const heldMemberships: {
			role: string;
			managed_by: string | null;
			sort: number | null;
		}[] = await trx
			.select('role', 'managed_by', 'sort')
			.from('directus_role_members')
			.where({ user: acceptingUser });

		const handRoles = heldMemberships
			.filter(({ managed_by }) => managed_by === null)
			.map(({ role }) => role);

		const grantedRoles = [...new Set(inviteRows.map(({ role }) => role))]
			.filter((role) => !handRoles.includes(role));

		const lastSort = Math.max(
			0,
			...heldMemberships.map(({ sort }) => sort ?? 0),
		);

		if (grantedRoles.length > 0) {
			await new RoleMembersService({ knex: trx, schema: this.schema })
				.createMany(grantedRoles.map((role, roleIndex) => {
					return {
						user: acceptingUser,
						role,
						sort: lastSort + roleIndex + 1,
					};
				}));
		}

		await new InvitesService({ knex: trx, schema: this.schema })
			.deleteMany(inviteRows.map(({ id }) => id));
	}

	async registerUser(input: RegisterUserInput) {
		if (
			input.verification_url &&
			isUrlAllowed(input.verification_url, env['USER_REGISTER_URL_ALLOW_LIST'] as string) === false
		) {
			throw new InvalidPayloadError({
				reason: `URL "${input.verification_url}" can't be used to verify registered users`,
			});
		}

		const STALL_TIME = env['REGISTER_STALL_TIME'] as number;
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

		const partialUser: Item = {
			// Required fields
			email: input.email,
			password: input.password,
			roles: publicRegistrationRole
				? [{ role: publicRegistrationRole }]
				: [],
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
					: new Url(env['PUBLIC_URL'] as string).addPath('users', 'register', 'verify-email')
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

		const user = await this.getUserByEmail(email);

		if (user?.status !== 'active') {
			await stall(STALL_TIME, timeStart);
			throw new ForbiddenError({
				reason: 'Inactive user',
			});
		}

		if (url && isUrlAllowed(url, env['PASSWORD_RESET_URL_ALLOW_LIST'] as string) === false) {
			throw new InvalidPayloadError({ reason: `URL "${url}" can't be used to reset passwords` });
		}

		const mailService = new MailService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		const payload = { email: user.email, scope: 'password-reset', hash: getSimpleHash('' + user.password) };
		const token = jwt.sign(payload, getSecret(), { expiresIn: '1d', issuer: 'directus' });

		const acceptUrl = (url ? new Url(url) : new Url(env['PUBLIC_URL'] as string).addPath('admin', 'reset-password'))
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

		const user = await this.getUserByEmail(email);

		if (user?.status !== 'active') {
			throw new ForbiddenError({
				reason: 'Inactive user',
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
}
