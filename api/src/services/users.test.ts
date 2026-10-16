import { ForbiddenError, InvalidPayloadError, RecordNotUniqueError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, MutationOptions } from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import {
	FailedValidationError,
	joiValidationErrorItemToErrorExtensions,
} from '@directus/validation';
import jwt from 'jsonwebtoken';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRemainingAdminUsers } from '../permissions/modules/validate-remaining-admin/validate-remaining-admin-users.js';
import emitter from '../emitter.js';
import { useLogger } from '../logger/index.js';
import { verifyJWT } from '../utils/jwt.js';
import { withMeta } from '../utils/read-meta.js';
import { ItemsService, MailService, UsersService } from './index.js';
import { SettingsService } from './settings.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseForAccountability: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('./mail', () => {
	const MailService = vi.fn();
	MailService.prototype.send = vi.fn().mockImplementation(() => Promise.resolve());

	return { MailService };
});

vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue({
		EMAIL_TEMPLATES_PATH: './templates',
		USERS_ADMIN_ACCESS_LIMIT: 3,
		USERS_APP_ACCESS_LIMIT: 3,
		USERS_API_ACCESS_LIMIT: 3,
		PUBLIC_URL: 'http://localhost:8055',
		USER_INVITE_URL_ALLOW_LIST: 'https://app.example.com/invite',
		USER_REGISTER_URL_ALLOW_LIST: 'https://app.example.com/verify',
		PASSWORD_RESET_URL_ALLOW_LIST: 'https://app.example.com/reset',
	}),
}));

vi.mock('../permissions/modules/validate-remaining-admin/validate-remaining-admin-users.js');

vi.mock('../utils/jwt.js', () => ({
	verifyJWT: vi.fn(),
}));

vi.mock('../utils/stall.js', () => ({
	stall: vi.fn().mockResolvedValue(undefined),
}));

const testRoleId = '4ccdb196-14b3-4ed1-b9da-c1978be07ca2';

const schema = new SchemaBuilder()
	.collection('directus_users', (c) => {
		c.field('id').uuid().primary().options({
			nullable: false,
		});

		c.field('first_name').string();
		c.field('email').string();
		c.field('password').string();
		c.field('status').string();
		c.field('role').uuid();
	})
	.build();

// Taken before the Users tests replace it on the prototype.
const itemsUpdateGroups = ItemsService.prototype.updateGroups;
const usersCheckUniqueEmails = (UsersService.prototype as any).checkUniqueEmails;
const usersCheckPasswordPolicy = (UsersService.prototype as any).checkPasswordPolicy;
const usersClearUserSessions = (UsersService.prototype as any).clearUserSessions;
const usersInviteUrl = (UsersService.prototype as any).inviteUrl;

describe('Integration Tests', () => {
	const db = knex.default({ client: MockClient });
	const tracker = createTracker(db);

	afterEach(() => {
		tracker.reset();
	});

	describe('Services / Users', () => {
		const service = new UsersService({
			knex: db,
			schema,
		});

		const superCreateOneSpy = vi.spyOn(ItemsService.prototype, 'createOne')
			.mockResolvedValue('user-id-1');

		const superUpdateGroupsSpy = vi.spyOn(ItemsService.prototype, 'updateGroups')
			.mockResolvedValue(['user-id-2']);

		const checkUniqueEmailsSpy = vi
			.spyOn(UsersService.prototype as any, 'checkUniqueEmails')
			.mockImplementation(() => vi.fn());

		const checkPasswordPolicySpy = vi
			.spyOn(UsersService.prototype as any, 'checkPasswordPolicy')
			.mockResolvedValue(() => vi.fn());

		const clearUserSessionsSpy = vi
			.spyOn(UsersService.prototype as any, 'clearUserSessions')
			.mockResolvedValue(() => vi.fn());

		afterEach(() => {
			vi.clearAllMocks();
		});

		describe('createOne', () => {
			it('should not checkUniqueEmails', async () => {
				await service.createOne({});

				expect(checkUniqueEmailsSpy).not.toBeCalled();
			});

			it('should checkUniqueEmails once', async () => {
				await service.createOne({ email: 'test@example.com' });

				expect(checkUniqueEmailsSpy).toBeCalledTimes(1);
			});

			it('should not checkPasswordPolicy', async () => {
				await service.createOne({});

				expect(checkPasswordPolicySpy).not.toBeCalled();
			});

			it('should checkPasswordPolicy once', async () => {
				await service.createOne({ password: 'testpassword' });

				expect(checkPasswordPolicySpy).toBeCalledTimes(1);
			});

			it('should request user limits checks', async () => {
				const opts: MutationOptions = {};

				await service.createOne({}, opts);

				expect(opts.userIntegrityCheckFlags).toBe(UserIntegrityCheckFlag.UserLimits);
			});
		});

		describe('createMany', () => {
			vi.spyOn(ItemsService.prototype, 'createMany').mockResolvedValue([1]);

			it('should not checkUniqueEmails', async () => {
				await service.createMany([{}]);

				expect(checkUniqueEmailsSpy).not.toBeCalled();
			});

			it('should checkUniqueEmails once', async () => {
				await service.createMany([{ email: 'test@example.com' }]);

				expect(checkUniqueEmailsSpy).toBeCalledTimes(1);
			});

			it('should not checkPasswordPolicy', async () => {
				await service.createMany([{}]);

				expect(checkPasswordPolicySpy).not.toBeCalled();
			});

			it('should checkPasswordPolicy once', async () => {
				await service.createMany([{ password: 'testpassword' }]);

				expect(checkPasswordPolicySpy).toBeCalledTimes(1);
			});

			it('should request user limits checks', async () => {
				const opts: MutationOptions = {};

				await service.createMany([{}], opts);

				expect(opts.userIntegrityCheckFlags).toBe(UserIntegrityCheckFlag.UserLimits);
			});
		});

		describe('updateMany', () => {
			it('should not request user integrity checks if no relevant fields are changed', async () => {
				const opts: MutationOptions = {};

				await service.updateMany(['user-id-3'], {}, opts);

				expect(opts.userIntegrityCheckFlags).toBe(undefined);
				expect(clearUserSessionsSpy).not.toBeCalled();
			});

			it('should request all user integrity checks if role is changed', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateMany(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000004'],
					{ role: testRoleId },
					{ onRequireUserIntegrityCheck },
				);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);
			});

			it('should request all user integrity checks if status is changed to not "active"', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateMany(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000005'],
					{ status: 'inactive' },
					{ onRequireUserIntegrityCheck },
				);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

				expect(clearUserSessionsSpy)
					.toHaveBeenCalledWith(['8e2b4c10-5d3a-4f6e-9a7b-000000000005']);
			});

			it('should request user limit checks if status is changed to "active"', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateMany(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000006'],
					{ status: 'active' },
					{ onRequireUserIntegrityCheck },
				);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.UserLimits);

				expect(clearUserSessionsSpy).not.toBeCalled();
			});

			it('should clear caches if role is changed', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const clearCacheSpy = vi.spyOn(UsersService.prototype as any, 'clearCaches');

				await service.updateMany(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000007'],
					{ role: testRoleId },
					{ onRequireUserIntegrityCheck: vi.fn() },
				);

				expect(clearCacheSpy).toHaveBeenCalled();
			});

			it('clears the caches when a users.update hook changes the role', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const clearCacheSpy = vi.spyOn(UsersService.prototype as any, 'clearCaches');
				const onRequireUserIntegrityCheck = vi.fn();

				const giveRole = () => {
					return [{
						data: { first_name: 'Ada', role: testRoleId },
						keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000040'],
					}];
				};

				emitter.onFilter('users.update', giveRole);

				try {
					await service.updateMany(
						['8e2b4c10-5d3a-4f6e-9a7b-000000000040'],
						{ first_name: 'Ada' },
						{ onRequireUserIntegrityCheck },
					);
				}
				finally {
					emitter.offFilter('users.update', giveRole);
				}

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

				expect(clearCacheSpy).toHaveBeenCalled();
			});

			it('logs out the users a users.update hook suspends', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				const suspendUser = () => {
					return [{
						data: { first_name: 'Ada', status: 'suspended' },
						keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000041'],
					}];
				};

				emitter.onFilter('users.update', suspendUser);

				try {
					await service.updateMany(
						['8e2b4c10-5d3a-4f6e-9a7b-000000000041'],
						{ first_name: 'Ada' },
						{ onRequireUserIntegrityCheck },
					);
				}
				finally {
					emitter.offFilter('users.update', suspendUser);
				}

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

				expect(clearUserSessionsSpy)
					.toHaveBeenCalledWith(['8e2b4c10-5d3a-4f6e-9a7b-000000000041']);
			});

			it('should not checkUniqueEmails', async () => {
				await service.updateMany(['user-id-8'], {});

				expect(checkUniqueEmailsSpy).not.toBeCalled();
			});

			it('should checkUniqueEmails once', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				await service.updateMany(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000009'],
					{ email: 'test@example.com' },
				);

				expect(checkUniqueEmailsSpy).toBeCalledTimes(1);

				expect(clearUserSessionsSpy).toHaveBeenCalledWith(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000009'],
					undefined,
				);
			});

			it('should disallow updating multiple items to same email', async () => {
				const opts: MutationOptions = {};

				await service.updateMany(['user-id-10', 'user-id-11'], { email: 'test@example.com' }, opts);

				expect(opts.preMutationErrorsByKey).toStrictEqual(new Map([
					[
						'user-id-10',
						new RecordNotUniqueError({
							collection: 'directus_users',
							field: 'email',
							value: 'test@example.com',
						}),
					],
					[
						'user-id-11',
						new RecordNotUniqueError({
							collection: 'directus_users',
							field: 'email',
							value: 'test@example.com',
						}),
					],
				]));
			});

			it('should not checkPasswordPolicy', async () => {
				await service.updateMany(['user-id-12'], {});

				expect(checkPasswordPolicySpy).not.toBeCalled();
				expect(clearUserSessionsSpy).not.toBeCalled();
			});

			it('should checkPasswordPolicy once', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				await service.updateMany(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000013'],
					{ password: 'testpassword' },
				);

				expect(checkPasswordPolicySpy).toBeCalledTimes(1);

				expect(clearUserSessionsSpy).toHaveBeenCalledWith(
					['8e2b4c10-5d3a-4f6e-9a7b-000000000013'],
					undefined,
				);
			});

			describe('restricted auth fields', () => {
				describe('should disallow updates for non-admin users', () => {
					const service = new UsersService({
						knex: db,
						schema,
						accountability: { role: 'test', admin: false } as Accountability,
					});

					it.each(['tfa_secret', 'provider', 'external_identifier'])('%s', async (field) => {
						const opts: MutationOptions = {};

						await service.updateMany([1], { [field]: 'test' }, opts);

						expect(superUpdateGroupsSpy).toHaveBeenCalled();

						expect(opts.preMutationErrorsByKey).toStrictEqual(new Map([[
							'1',
							new InvalidPayloadError({
								reason: `You can't change the "${field}" value manually`,
							}),
						]]));
					});
				});

				describe.each([
					['admin users', { role: 'admin', admin: true } as Accountability],
					['null accountability', null],
				])('should allow updates for %s', (_, accountability) => {
					const service = new UsersService({
						knex: db,
						schema,
						accountability,
					});

					it.each(['provider', 'external_identifier'])('%s', async (field) => {
						const promise = service.updateMany(['user-id-14'], { [field]: 'test' });

						await expect(promise).resolves.not.toThrow();

						expect(superUpdateGroupsSpy).toHaveBeenCalledWith(
							[{ data: { [field]: 'test', auth_data: null }, keys: ['user-id-14'] }],
							{},
						);
					});
				});
			});
		});

		describe('updateBatch', () => {
			it('refuses a row that sets tfa_secret', async () => {
				const opts: MutationOptions = {};

				await service.updateBatch(
					[{ id: 'user-id-20', tfa_secret: 'secret' }],
					opts,
				);

				expect(opts.preMutationErrorsByKey).toStrictEqual(new Map([[
					'user-id-20',
					new InvalidPayloadError({
						reason: `You can't change the "tfa_secret" value manually`,
					}),
				]]));
			});

			it('checks the password policy of every row', async () => {
				await service.updateBatch([
					{ id: 'user-id-21', password: 'first-password' },
					{ id: 'user-id-22', password: 'second-password' },
				]);

				expect(checkPasswordPolicySpy)
					.toHaveBeenNthCalledWith(1, ['first-password']);

				expect(checkPasswordPolicySpy)
					.toHaveBeenNthCalledWith(2, ['second-password']);
			});

			it('checks emails against the users the batch keeps', async () => {
				await service.updateBatch([
					{ id: 'user-id-23', email: 'first@example.com' },
					{ id: 'user-id-24', email: 'second@example.com' },
				]);

				expect(checkUniqueEmailsSpy).toHaveBeenNthCalledWith(
					1,
					['first@example.com'],
					['user-id-23', 'user-id-24'],
				);

				expect(checkUniqueEmailsSpy).toHaveBeenNthCalledWith(
					2,
					['second@example.com'],
					['user-id-23', 'user-id-24'],
				);
			});

			it('refuses two rows set to the same email, whatever the casing', async () => {
				const opts: MutationOptions = {};

				await service.updateBatch([
					{ id: 'user-id-25', email: 'same@example.com' },
					{ id: 'user-id-26', email: 'SAME@example.com' },
				], opts);

				expect(opts.preMutationErrorsByKey).toStrictEqual(new Map([[
					'user-id-26',
					new RecordNotUniqueError({
						collection: 'directus_users',
						field: 'email',
						value: 'SAME@example.com',
					}),
				]]));
			});

			it('keeps each row\'s own error when several rows are refused', async () => {
				const opts: MutationOptions = {};

				await service.updateBatch([
					{ id: 'user-id-27', tfa_secret: 'secret' },
					{ id: 'user-id-28', email: 'not-an-email' },
				], opts);

				expect(opts.preMutationErrorsByKey).toStrictEqual(new Map<string, Error>([
					[
						'user-id-27',
						new InvalidPayloadError({
							reason: `You can't change the "tfa_secret" value manually`,
						}),
					],
					[
						'user-id-28',
						new FailedValidationError({
							field: 'email',
							type: 'email',
							path: [],
						}),
					],
				]));
			});

			it('requests the union of every row\'s integrity checks once', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateBatch([
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000029', status: 'active' },
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000030', role: testRoleId },
				], { onRequireUserIntegrityCheck });

				expect(onRequireUserIntegrityCheck).toHaveBeenCalledTimes(1);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);
			});

			it('logs out the users a row suspends', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_users').response(1);

				await service.updateBatch([
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000031', status: 'suspended' },
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000032', first_name: 'Ada' },
				], { onRequireUserIntegrityCheck: vi.fn() });

				expect(clearUserSessionsSpy).toHaveBeenCalledTimes(1);

				expect(clearUserSessionsSpy)
					.toHaveBeenCalledWith(['8e2b4c10-5d3a-4f6e-9a7b-000000000031']);
			});
		});

		describe('deleteMany', () => {
			vi.spyOn(ItemsService.prototype, 'deleteMany').mockResolvedValue(['user-id-15']);

			it('should validate remaining admin users', async () => {
				// mock notifications update query in deleteOne/deleteMany/deleteByQuery methods
				tracker.on.update('directus_notifications').response({});
				// mock versions update query in deleteOne/deleteMany/deleteByQuery methods
				tracker.on.update('directus_versions').response({});
				// mock comments update query in deleteOne/deleteMany/deleteByQuery methods
				tracker.on.update('directus_comments').response({});

				const service = new UsersService({
					knex: db,
					schema,
					accountability: { role: 'test', admin: false } as Accountability,
				});

				await service.deleteMany(['user-id-16']);

				expect(validateRemainingAdminUsers).toHaveBeenCalled();
				expect(clearUserSessionsSpy).toBeCalled();
			});
		});

		describe('invite', () => {
			const mailService = new MailService({
				schema,
			});

			vi.spyOn(UsersService.prototype as any, 'inviteUrl').mockImplementation(() => vi.fn());

			it('should invite new users', async () => {
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce(undefined);

				const service = new UsersService({
					knex: db,
					schema,
					accountability: { role: 'test', admin: true } as Accountability,
				});

				const promise = service.inviteUser('user@example.com', 'invite-role', null);

				await expect(promise).resolves.not.toThrow();

				expect(superCreateOneSpy.mock.lastCall![0]).toEqual(
					expect.objectContaining({
						email: 'user@example.com',
						status: 'invited',
						role: 'invite-role',
					}),
				);

				expect(mailService.send).toBeCalledTimes(1);
			});

			it('should re-send invites for invited users', async () => {
				const service = new UsersService({
					knex: db,
					schema,
					accountability: { role: 'test', admin: true } as Accountability,
				});

				// mock an invited user
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail').mockResolvedValueOnce({
					status: 'invited',
					role: 'invite-role',
				});

				const promise = service.inviteUser('user@example.com', 'invite-role', null);
				await expect(promise).resolves.not.toThrow();

				expect(superCreateOneSpy).not.toBeCalled();
				expect(mailService.send).toBeCalledTimes(1);
			});

			it('should not re-send invites for users in state other than invited', async () => {
				const service = new UsersService({
					knex: db,
					schema,
					accountability: { role: 'test', admin: true } as Accountability,
				});

				// mock an active user
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail').mockResolvedValueOnce({
					status: 'active',
					role: 'invite-role',
				});

				const promise = service.inviteUser('user@example.com', 'invite-role', null);
				await expect(promise).resolves.not.toThrow();

				expect(superCreateOneSpy).not.toBeCalled();
				expect(mailService.send).not.toBeCalled();
			});

			it('should update role when re-sent invite contains different role than user has', async () => {
				const service = new UsersService({
					knex: db,
					schema,
					accountability: { role: 'test', admin: true } as Accountability,
				});

				const mockUser = {
					id: 'user-id-17',
					status: 'invited',
					role: 'existing-role',
				};

				// mock an invited user with different role
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce(mockUser);

				tracker.on.select('directus_users').response({ id: mockUser.id });

				const promise = service.inviteUser('user@example.com', 'invite-role', null);
				await expect(promise).resolves.not.toThrow();

				expect(superUpdateGroupsSpy).toHaveBeenCalledWith(
					[{ data: { role: 'invite-role' }, keys: [mockUser.id] }],
					expect.anything(),
				);
			});

			it(
				'refuses re-inviting an invited user to a URL off the allow list',
				async () => {
					vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
						.mockResolvedValueOnce({ status: 'invited', role: 'invite-role' });

					const promise = service.inviteUser(
						'user@example.com',
						'invite-role',
						'https://elsewhere.example.com/invite',
					);

					await expect(promise).rejects.toEqual(new InvalidPayloadError({
						reason: 'URL "https://elsewhere.example.com/invite" '
							+ 'can\'t be used to invite users',
					}));

					expect(mailService.send).not.toBeCalled();
				},
			);

			it(
				'refuses inviting an active user to a URL off the allow list',
				async () => {
					vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
						.mockResolvedValueOnce({ status: 'active', role: 'other-role' });

					const promise = service.inviteUser(
						'user@example.com',
						'invite-role',
						'https://elsewhere.example.com/invite',
					);

					await expect(promise).rejects.toEqual(new InvalidPayloadError({
						reason: 'URL "https://elsewhere.example.com/invite" '
							+ 'can\'t be used to invite users',
					}));
				},
			);
		});

		describe('acceptInvite', () => {
			it('should reject a token whose scope is not "invite" (users.ts L420)', async () => {
				vi.mocked(verifyJWT).mockReturnValue({ email: 'user@example.com', scope: 'password-reset' } as any);

				const getUserByEmailSpy = vi.spyOn(UsersService.prototype as any, 'getUserByEmail');

				const promise = service.acceptInvite('bad-token', 'new-password');

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Not an invite token');

				expect(getUserByEmailSpy).not.toBeCalled();
			});
		});

		describe('verifyRegistration', () => {
			it('should reject a token whose scope is not "pending-registration" (users.ts L551)', async () => {
				vi.mocked(verifyJWT).mockReturnValue({ email: 'user@example.com', scope: 'invite' } as any);

				const getUserByEmailSpy = vi.spyOn(UsersService.prototype as any, 'getUserByEmail');

				const promise = service.verifyRegistration('bad-token');

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Not a pending registration token');

				expect(getUserByEmailSpy).not.toBeCalled();
			});
		});

		describe('resetPassword', () => {
			it('should reject a token whose scope is not "password-reset" (users.ts L625)', async () => {
				vi.mocked(verifyJWT).mockReturnValue({ email: 'user@example.com', scope: 'invite', hash: 'abc' } as any);

				const promise = service.resetPassword('bad-token', 'new-password');

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Not a password reset token');
			});

			it('should reject a password-reset token without a hash (users.ts L625)', async () => {
				vi.mocked(verifyJWT).mockReturnValue({ email: 'user@example.com', scope: 'password-reset', hash: '' } as any);

				const promise = service.resetPassword('bad-token', 'new-password');

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Not a password reset token');
			});

			it('should reject when the target user is not active (users.ts L640)', async () => {
				vi.mocked(verifyJWT).mockReturnValue({
					email: 'user@example.com',
					scope: 'password-reset',
					hash: 'some-hash',
				} as any);

				vi.spyOn(UsersService.prototype as any, 'checkPasswordPolicy')
					.mockResolvedValue(undefined);

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail').mockResolvedValueOnce({
					id: 'user-id-reset-1',
					status: 'suspended',
					password: 'hashed',
				});

				const promise = service.resetPassword('reset-token', 'new-password');

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Inactive user');
			});

			it('should reject when the token hash does not match the user (users.ts L646)', async () => {
				vi.mocked(verifyJWT).mockReturnValue({
					email: 'user@example.com',
					scope: 'password-reset',
					hash: 'mismatching-hash',
				} as any);

				vi.spyOn(UsersService.prototype as any, 'checkPasswordPolicy')
					.mockResolvedValue(undefined);

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail').mockResolvedValueOnce({
					id: 'user-id-reset-2',
					status: 'active',
					password: 'hashed',
				});

				const promise = service.resetPassword('reset-token', 'new-password');

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Bad user credentials');
			});
		});

		describe('requestPasswordReset', () => {
			it('should reject when the target user is not active (users.ts L575)', async () => {
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail').mockResolvedValueOnce({
					id: 'user-id-req-1',
					status: 'suspended',
				});

				const promise = service.requestPasswordReset('user@example.com', null);

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Inactive user');
			});
		});

		describe('registerUser', () => {
			it('should reject when public registration is disabled (users.ts L464)', async () => {
				vi.spyOn(SettingsService.prototype, 'readSingleton').mockResolvedValueOnce(
					withMeta({ public_registration: false }, { scopedCacheFingerprints: [] }),
				);

				const promise = service.registerUser({ email: 'user@example.com', password: 'new-password' });

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Public registration is disabled');
			});

			it('should reject when the email fails the configured email filter (users.ts L489)', async () => {
				vi.spyOn(SettingsService.prototype, 'readSingleton').mockResolvedValueOnce(
					withMeta({
						public_registration: true,
						public_registration_email_filter: {
							email: { _ends_with: '@allowed.com' },
						},
					}, { scopedCacheFingerprints: [] }),
				);

				const promise = service.registerUser({ email: 'user@example.com', password: 'new-password' });

				await expect(promise).rejects.toThrowError(ForbiddenError);
				await expect(promise).rejects.toThrowError('Invalid payload');
			});
		});

		describe('email uniqueness', () => {
			it('refuses two new users whose emails differ by casing only', async () => {
				checkUniqueEmailsSpy.mockImplementationOnce(usersCheckUniqueEmails);
				const opts: MutationOptions = {};

				await service.createMany([
					{ email: 'Ada@example.com' },
					{ email: 'ada@example.com' },
				], opts);

				expect(opts.preMutationError).toStrictEqual(new RecordNotUniqueError({
					collection: 'directus_users',
					field: 'email',
					value: '[ada@example.com]',
				}));
			});

			it('refuses an email another user holds in any casing', async () => {
				checkUniqueEmailsSpy.mockImplementationOnce(usersCheckUniqueEmails);
				tracker.on.select('directus_users').response([{ email: 'ada@example.com' }]);
				const opts: MutationOptions = {};

				await service.createOne({ email: 'Ada@Example.com' }, opts);

				expect(opts.preMutationError).toStrictEqual(new RecordNotUniqueError({
					collection: 'directus_users',
					field: 'email',
					value: '[ada@example.com]',
				}));

				expect(tracker.history.select[0]?.bindings)
					.toStrictEqual(['ada@example.com']);
			});

			it('skips the users the batch rewrites when looking up a holder', async () => {
				checkUniqueEmailsSpy.mockImplementationOnce(usersCheckUniqueEmails);
				tracker.on.select('directus_users').response([]);
				const opts: MutationOptions = {};

				await service.updateBatch(
					[{ id: 'user-id-40', email: 'new@example.com' }],
					opts,
				);

				expect(opts.preMutationErrorsByKey).toBe(undefined);

				expect(tracker.history.select[0]?.bindings)
					.toStrictEqual(['new@example.com', 'user-id-40']);
			});
		});

		describe('password policy', () => {
			it('accepts any password when no policy is set', async () => {
				checkPasswordPolicySpy.mockImplementationOnce(usersCheckPasswordPolicy);

				const readSingleton = vi.spyOn(SettingsService.prototype, 'readSingleton')
					.mockResolvedValueOnce(withMeta(
						{ auth_password_policy: null },
						{ scopedCacheFingerprints: [] },
					));

				const opts: MutationOptions = {};

				await service.createOne({ password: 'x' }, opts);

				expect(opts.preMutationError).toBe(undefined);

				expect(readSingleton)
					.toHaveBeenCalledWith({ fields: ['auth_password_policy'] });
			});

			it('refuses a password failing a slash-wrapped policy', async () => {
				checkPasswordPolicySpy.mockImplementationOnce(usersCheckPasswordPolicy);

				vi.spyOn(SettingsService.prototype, 'readSingleton')
					.mockResolvedValueOnce(withMeta(
						{ auth_password_policy: '/^.{8,}$/' },
						{ scopedCacheFingerprints: [] },
					));

				const opts: MutationOptions = {};

				await service.createOne({ password: 'short' }, opts);

				expect(opts.preMutationError).toStrictEqual(new FailedValidationError(
					joiValidationErrorItemToErrorExtensions({
						message: `Provided password doesn't match password policy`,
						path: ['password'],
						type: 'custom.pattern.base',
						context: { value: 'short' },
					}),
				));
			});

			it('accepts a password matching a slash-wrapped policy', async () => {
				checkPasswordPolicySpy.mockImplementationOnce(usersCheckPasswordPolicy);

				vi.spyOn(SettingsService.prototype, 'readSingleton')
					.mockResolvedValueOnce(withMeta(
						{ auth_password_policy: '/^.{8,}$/' },
						{ scopedCacheFingerprints: [] },
					));

				const opts: MutationOptions = {};

				await service.createOne({ password: 'long-enough' }, opts);

				expect(opts.preMutationError).toBe(undefined);
			});

			it('accepts a password matching a bare policy', async () => {
				checkPasswordPolicySpy.mockImplementationOnce(usersCheckPasswordPolicy);

				vi.spyOn(SettingsService.prototype, 'readSingleton')
					.mockResolvedValueOnce(withMeta(
						{ auth_password_policy: '^.{8,}$' },
						{ scopedCacheFingerprints: [] },
					));

				const opts: MutationOptions = {};

				await service.createOne({ password: 'long-enough' }, opts);

				expect(opts.preMutationError).toBe(undefined);
			});
		});

		describe('user sessions', () => {
			it('deletes every session of the deleted users', async () => {
				clearUserSessionsSpy.mockImplementationOnce(usersClearUserSessions);
				tracker.on.update('directus_comments').response(0);
				tracker.on.update('directus_notifications').response(0);
				tracker.on.update('directus_versions').response(0);
				tracker.on.delete('directus_sessions').response(1);

				await service.deleteMany(['user-id-41']);

				expect(tracker.history.delete[0]?.bindings)
					.toStrictEqual(['user-id-41']);
			});

			it('keeps the caller\'s own session when it changes a password', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				clearUserSessionsSpy.mockImplementationOnce(usersClearUserSessions);

				tracker.on.select('directus_users').response([
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000044' },
				]);

				tracker.on.update('directus_users').response(1);
				tracker.on.delete('directus_sessions').response(1);

				await new UsersService({
					knex: db,
					schema,
					accountability: {
						admin: true,
						session: 'session-token-1',
					} as Accountability,
				}).updateBatch([{
					id: '8e2b4c10-5d3a-4f6e-9a7b-000000000044',
					password: 'new-password',
				}], { onRequireUserIntegrityCheck: vi.fn() });

				expect(tracker.history.delete[0]?.bindings).toStrictEqual([
					'8e2b4c10-5d3a-4f6e-9a7b-000000000044',
					'session-token-1',
				]);
			});
		});

		describe('deleteMany without a caller integrity hook', () => {
			it('keeps the last admin refusal for the mutation', async () => {
				const lastAdminError = new Error('last admin');

				vi.mocked(validateRemainingAdminUsers)
					.mockRejectedValueOnce(lastAdminError);

				tracker.on.update('directus_comments').response(0);
				tracker.on.update('directus_notifications').response(0);
				tracker.on.update('directus_versions').response(0);
				const opts: MutationOptions = {};

				await service.deleteMany(['user-id-45'], opts);

				expect(opts.preMutationError).toBe(lastAdminError);
			});

			it('keeps the references to a last admin its refusal keeps', async () => {
				vi.mocked(validateRemainingAdminUsers)
					.mockRejectedValueOnce(new Error('last admin'));

				await service.deleteMany(['user-id-46']);

				expect(tracker.history.update).toEqual([]);
			});
		});

		describe('verifyRegistration by email', () => {
			it('activates the unverified user the token names', async () => {
				vi.mocked(verifyJWT).mockReturnValue({
					email: 'Ada@Example.com',
					scope: 'pending-registration',
				} as any);

				tracker.on.select('directus_users').response({
					id: 'user-id-42',
					status: 'unverified',
				});

				await expect(service.verifyRegistration('verify-token'))
					.resolves.toBe('user-id-42');

				expect(tracker.history.select[0]?.bindings)
					.toStrictEqual(['ada@example.com', 1]);

				expect(superUpdateGroupsSpy).toHaveBeenCalledWith(
					[{ data: { status: 'active' }, keys: ['user-id-42'] }],
					expect.anything(),
				);
			});
		});

		describe('mail links', () => {
			it('invites to an allowed url and logs a mail that fails', async () => {
				vi.spyOn(UsersService.prototype as any, 'inviteUrl')
					.mockImplementationOnce(usersInviteUrl);

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce(undefined);

				vi.spyOn(jwt, 'sign').mockReturnValueOnce('invite-token' as any);
				const mailError = new Error('SMTP down');

				const sendMail = vi.mocked(MailService.prototype.send)
					.mockRejectedValueOnce(mailError);

				const logError = vi.spyOn(useLogger(), 'error').mockReturnValue();

				await service.inviteUser(
					'ada@example.com',
					'invite-role',
					'https://app.example.com/invite',
				);

				expect(sendMail).toHaveBeenCalledWith({
					to: 'ada@example.com',
					subject: 'You\'ve been invited',
					template: {
						name: 'user-invitation',
						data: {
							url: 'https://app.example.com/invite?token=invite-token',
							email: 'ada@example.com',
						},
					},
				});

				await vi.waitFor(() => {
					expect(logError).toHaveBeenCalledWith(
						mailError,
						'Could not send user invitation mail',
					);
				});
			});

			it('invites to the admin app when no url is given', async () => {
				vi.spyOn(UsersService.prototype as any, 'inviteUrl')
					.mockImplementationOnce(usersInviteUrl);

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce(undefined);

				vi.spyOn(jwt, 'sign').mockReturnValueOnce('invite-token' as any);
				const sendMail = vi.mocked(MailService.prototype.send);

				await service.inviteUser('ada@example.com', 'invite-role', null, 'Join');

				expect(sendMail).toHaveBeenCalledWith({
					to: 'ada@example.com',
					subject: 'Join',
					template: {
						name: 'user-invitation',
						data: {
							url: 'http://localhost:8055/admin/accept-invite'
								+ '?token=invite-token',
							email: 'ada@example.com',
						},
					},
				});
			});

			it('refuses a registration verification url off the allow list', async () => {
				await expect(service.registerUser({
					email: 'ada@example.com',
					password: 'new-password',
					verification_url: 'https://evil.example.com/verify',
				})).rejects.toStrictEqual(new InvalidPayloadError({
					reason: 'URL "https://evil.example.com/verify" can\'t be used'
						+ ' to verify registered users',
				}));
			});

			it('mails the verification to an allowed url and logs a failure', async () => {
				vi.spyOn(SettingsService.prototype, 'readSingleton')
					.mockResolvedValueOnce(withMeta({
						public_registration: true,
						public_registration_verify_email: true,
						public_registration_role: 'role-id-1',
					}, { scopedCacheFingerprints: [] }));

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce(undefined);

				vi.spyOn(jwt, 'sign').mockReturnValueOnce('verify-token' as any);
				const mailError = new Error('SMTP down');

				const sendMail = vi.mocked(MailService.prototype.send)
					.mockRejectedValueOnce(mailError);

				const logError = vi.spyOn(useLogger(), 'error').mockReturnValue();

				await service.registerUser({
					email: 'ada@example.com',
					password: 'new-password',
					first_name: 'Ada',
					verification_url: 'https://app.example.com/verify',
				});

				expect(superCreateOneSpy).toHaveBeenCalledWith(
					{
						email: 'ada@example.com',
						password: 'new-password',
						role: 'role-id-1',
						status: 'unverified',
						first_name: 'Ada',
						last_name: null,
					},
					{},
				);

				expect(sendMail).toHaveBeenCalledWith({
					to: 'ada@example.com',
					subject: 'Verify your email address',
					template: {
						name: 'user-registration',
						data: {
							url: 'https://app.example.com/verify?token=verify-token',
							email: 'ada@example.com',
							first_name: 'Ada',
							last_name: null,
						},
					},
				});

				await vi.waitFor(() => {
					expect(logError).toHaveBeenCalledWith(
						mailError,
						'Could not send email verification mail',
					);
				});
			});

			it('mails the verification to the api when no url is given', async () => {
				vi.spyOn(SettingsService.prototype, 'readSingleton')
					.mockResolvedValueOnce(withMeta({
						public_registration: true,
						public_registration_verify_email: true,
					}, { scopedCacheFingerprints: [] }));

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce({ id: 'user-id-46', status: 'unverified' });

				vi.spyOn(jwt, 'sign').mockReturnValueOnce('verify-token' as any);
				const sendMail = vi.mocked(MailService.prototype.send);

				await service.registerUser({
					email: 'ada@example.com',
					password: 'new-password',
				});

				expect(superCreateOneSpy).not.toHaveBeenCalled();

				expect(sendMail).toHaveBeenCalledWith({
					to: 'ada@example.com',
					subject: 'Verify your email address',
					template: {
						name: 'user-registration',
						data: {
							url: 'http://localhost:8055/users/register/verify-email'
								+ '?token=verify-token',
							email: 'ada@example.com',
							first_name: null,
							last_name: null,
						},
					},
				});
			});

			it('mails a reset link to an allowed url and logs a failure', async () => {
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce({
						id: 'user-id-47',
						status: 'active',
						email: 'ada@example.com',
						password: 'hashed',
					});

				vi.spyOn(jwt, 'sign').mockReturnValueOnce('reset-token' as any);
				const mailError = new Error('SMTP down');

				const sendMail = vi.mocked(MailService.prototype.send)
					.mockRejectedValueOnce(mailError);

				const logError = vi.spyOn(useLogger(), 'error').mockReturnValue();

				await service.requestPasswordReset(
					'ada@example.com',
					'https://app.example.com/reset',
					'Reset it',
				);

				expect(sendMail).toHaveBeenCalledWith({
					to: 'ada@example.com',
					subject: 'Reset it',
					template: {
						name: 'password-reset',
						data: {
							url: 'https://app.example.com/reset?token=reset-token',
							email: 'ada@example.com',
						},
					},
				});

				await vi.waitFor(() => {
					expect(logError).toHaveBeenCalledWith(
						mailError,
						'Could not send password reset mail',
					);
				});
			});

			it('mails a reset link to the admin app when no url is given', async () => {
				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce({
						id: 'user-id-48',
						status: 'active',
						email: 'ada@example.com',
						password: 'hashed',
					});

				vi.spyOn(jwt, 'sign').mockReturnValueOnce('reset-token' as any);
				const sendMail = vi.mocked(MailService.prototype.send);

				await service.requestPasswordReset('ada@example.com', null);

				expect(sendMail).toHaveBeenCalledWith({
					to: 'ada@example.com',
					subject: 'Password Reset Request',
					template: {
						name: 'password-reset',
						data: {
							url: 'http://localhost:8055/admin/reset-password'
								+ '?token=reset-token',
							email: 'ada@example.com',
						},
					},
				});
			});
		});

		describe('resetPassword as admin', () => {
			it('updates as an admin built from the default accountability', async () => {
				vi.mocked(verifyJWT).mockReturnValue({
					email: 'ada@example.com',
					scope: 'password-reset',
					hash: '48fb3dd3',
				} as any);

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce({
						id: 'user-id-49',
						status: 'active',
						password: 'hashed',
					});

				tracker.on.select('directus_users').response({ id: 'user-id-49' });

				await service.resetPassword('reset-token', 'new-password');

				expect(superUpdateGroupsSpy.mock.contexts[0]).toMatchObject({
					accountability: {
						role: null,
						user: null,
						roles: [],
						admin: true,
						app: false,
						ip: null,
					},
				});
			});

			it('updates as an admin built from the caller', async () => {
				vi.mocked(verifyJWT).mockReturnValue({
					email: 'ada@example.com',
					scope: 'password-reset',
					hash: '48fb3dd3',
				} as any);

				vi.spyOn(UsersService.prototype as any, 'getUserByEmail')
					.mockResolvedValueOnce({
						id: 'user-id-50',
						status: 'active',
						password: 'hashed',
					});

				tracker.on.select('directus_users').response({ id: 'user-id-50' });

				await new UsersService({
					knex: db,
					schema,
					accountability: {
						role: null,
						user: null,
						roles: [],
						admin: false,
						app: false,
						ip: '10.0.0.2',
					},
				}).resetPassword('reset-token', 'new-password');

				expect(superUpdateGroupsSpy.mock.contexts[0]).toMatchObject({
					accountability: {
						role: null,
						user: null,
						roles: [],
						admin: true,
						app: false,
						ip: '10.0.0.2',
					},
				});
			});
		});
	});
});
