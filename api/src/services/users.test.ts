import { ForbiddenError, InvalidPayloadError, RecordNotUniqueError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, MutationOptions } from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { FailedValidationError } from '@directus/validation';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRemainingAdminUsers } from '../permissions/modules/validate-remaining-admin/validate-remaining-admin-users.js';
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
	})
	.build();

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
				const opts: MutationOptions = {};

				await service.updateMany(['user-id-4'], { role: testRoleId }, opts);

				expect(opts.userIntegrityCheckFlags).toBe(UserIntegrityCheckFlag.All);
			});

			it('should request all user integrity checks if status is changed to not "active"', async () => {
				const opts: MutationOptions = {};

				await service.updateMany(['user-id-5'], { status: 'inactive' }, opts);

				expect(opts.userIntegrityCheckFlags).toBe(UserIntegrityCheckFlag.All);
				expect(clearUserSessionsSpy).toBeCalled();
			});

			it('should request user limit checks if status is changed to "active"', async () => {
				const opts: MutationOptions = {};

				await service.updateMany(['user-id-6'], { status: 'active' }, opts);

				expect(opts.userIntegrityCheckFlags).toBe(UserIntegrityCheckFlag.UserLimits);
				expect(clearUserSessionsSpy).not.toBeCalled();
			});

			it('should clear caches if role is changed', async () => {
				const clearCacheSpy = vi.spyOn(UsersService.prototype as any, 'clearCaches');

				await service.updateMany(['user-id-7'], { role: testRoleId });

				expect(clearCacheSpy).toHaveBeenCalled();
			});

			it('should not checkUniqueEmails', async () => {
				await service.updateMany(['user-id-8'], {});

				expect(checkUniqueEmailsSpy).not.toBeCalled();
			});

			it('should checkUniqueEmails once', async () => {
				await service.updateMany(['user-id-9'], { email: 'test@example.com' });

				expect(checkUniqueEmailsSpy).toBeCalledTimes(1);
				expect(clearUserSessionsSpy).toBeCalled();
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

				expect(clearUserSessionsSpy).toBeCalled();
			});

			it('should not checkPasswordPolicy', async () => {
				await service.updateMany(['user-id-12'], {});

				expect(checkPasswordPolicySpy).not.toBeCalled();
				expect(clearUserSessionsSpy).not.toBeCalled();
			});

			it('should checkPasswordPolicy once', async () => {
				await service.updateMany(['user-id-13'], { password: 'testpassword' });

				expect(checkPasswordPolicySpy).toBeCalledTimes(1);
				expect(clearUserSessionsSpy).toBeCalled();
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
				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateBatch([
					{ id: 'user-id-29', status: 'active' },
					{ id: 'user-id-30', role: testRoleId },
				], { onRequireUserIntegrityCheck });

				expect(onRequireUserIntegrityCheck).toHaveBeenCalledTimes(1);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);
			});

			it('logs out the users a row suspends', async () => {
				await service.updateBatch([
					{ id: 'user-id-31', status: 'suspended' },
					{ id: 'user-id-32', first_name: 'Ada' },
				]);

				expect(clearUserSessionsSpy).toHaveBeenCalledTimes(1);
				expect(clearUserSessionsSpy).toHaveBeenCalledWith(['user-id-31']);
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

				const promise = service.inviteUser('user@example.com', 'invite-role', null);
				await expect(promise).resolves.not.toThrow();

				expect(superUpdateGroupsSpy).toHaveBeenCalledWith(
					[{ data: { role: 'invite-role' }, keys: [mockUser.id] }],
					{ userIntegrityCheckFlags: UserIntegrityCheckFlag.All },
				);
			});
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
	});
});
