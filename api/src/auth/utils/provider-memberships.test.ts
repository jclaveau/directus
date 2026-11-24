import type { SchemaOverview } from '@directus/types';
import { oneLine } from '@directus/utils';
import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RoleMembersService } from '../../services/role-members.js';
import { transaction } from '../../utils/transaction.js';
import {
	providerMemberships,
	syncProviderMemberships,
	takeProviderRoles,
	withProviderRoles,
} from './provider-memberships.js';

vi.mock('../../services/role-members.js');
vi.mock('../../utils/transaction.js');

afterEach(() => {
	vi.restoreAllMocks();
});

describe('withProviderRoles', () => {
	test('lists the roles, and no role key, in the payload', () => {
		const hookPayload = withProviderRoles(
			'auth.create',
			{ email: 'a@b.c' },
			['role-a'],
		);

		expect(JSON.parse(JSON.stringify(hookPayload))).toEqual({
			email: 'a@b.c',
			roles: ['role-a'],
		});
	});

	test('leaves the roles out when the login syncs none', () => {
		expect(JSON.parse(JSON.stringify(
			withProviderRoles('auth.update', { email: 'a@b.c' }, undefined),
		))).toEqual({ email: 'a@b.c' });
	});

	test('refuses a hook reading the removed role', () => {
		const hookPayload = withProviderRoles('auth.update', {}, ['role-a']);

		expect(() => hookPayload['role']).toThrow(new Error(
			'The "auth.update" payload has no "role" since multi-role (#746):'
			+ ' read or set "roles"',
		));
	});

	test('refuses a hook setting the removed role', () => {
		const hookPayload = withProviderRoles('auth.create', {}, ['role-a']);

		expect(() => {
			hookPayload['role'] = 'role-b';
		}).toThrow(new Error(
			'The "auth.create" payload has no "role" since multi-role (#746):'
			+ ' read or set "roles"',
		));
	});
});

describe('takeProviderRoles', () => {
	test('moves the roles out of the payload', () => {
		expect(takeProviderRoles(
			'auth.update',
			withProviderRoles('auth.update', { email: 'a@b.c' }, ['role-a']),
		)).toEqual({
			userPayload: { email: 'a@b.c' },
			providerRoles: ['role-a'],
		});
	});

	test('returns undefined roles when the payload names none', () => {
		expect(takeProviderRoles('auth.update', { email: 'a@b.c' })).toEqual({
			userPayload: { email: 'a@b.c' },
			providerRoles: undefined,
		});
	});

	test('refuses a hook returning its own role key', () => {
		expect(() => {
			return takeProviderRoles('auth.create', { email: 'a@b.c', role: 'r' });
		}).toThrow(new Error(
			'The "auth.create" payload has no "role" since multi-role (#746):'
			+ ' read or set "roles"',
		));
	});

	test('refuses roles that are no list of role ids', () => {
		expect(() => {
			return takeProviderRoles('auth.update', { roles: 'role-a' });
		}).toThrow(new Error(
			'The "auth.update" payload lists its "roles" as role ids, got "role-a"',
		));
	});
});

describe('providerMemberships', () => {
	test('gives the provider the mapped role', () => {
		expect(providerMemberships('github', ['role-a'], true)).toEqual([
			{ role: 'role-a', managed_by: 'auth:github' },
		]);
	});

	test('leaves a role no mapping gave to the admin', () => {
		expect(providerMemberships('github', ['role-default'], false)).toEqual([
			{ role: 'role-default', managed_by: null },
		]);
	});

	test('gives none for undefined roles', () => {
		expect(providerMemberships('github', undefined, true)).toEqual([]);
	});
});

describe('syncProviderMemberships', () => {
	let knexMock: Knex.Transaction;

	let userRows: {
		id: string;
		role: string;
		managed_by: string | null;
		sort: number | null;
	}[];

	let deleteMany: ReturnType<typeof vi.fn>;
	let createMany: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		userRows = [];
		deleteMany = vi.fn();
		createMany = vi.fn();

		vi.mocked(RoleMembersService).mockClear();
		vi.mocked(transaction).mockClear();

		vi.mocked(RoleMembersService).mockImplementation(function () {
			return { deleteMany, createMany } as any;
		});

		vi.mocked(transaction).mockImplementation(async (knex, handler) => {
			return handler(knex);
		});

		knexMock = {
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockImplementation(async () => userRows),
			transaction: vi.fn(async () => knexMock),
			commit: vi.fn(),
			rollback: vi.fn(),
		} as unknown as Knex.Transaction;
	});

	test('reads the user\'s rows in one select', async () => {
		await syncProviderMemberships('user-1', 'github', [], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(knexMock.select)
			.toHaveBeenCalledWith('id', 'role', 'managed_by', 'sort');

		expect(knexMock.from).toHaveBeenCalledWith('directus_role_members');
		expect(knexMock.where).toHaveBeenCalledWith({ user: 'user-1' });
	});

	test('puts the mapped roles after the user\'s others', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-hand', managed_by: null, sort: 1 },
			{ id: 'row-2', role: 'role-press', managed_by: 'ext:sync', sort: 3 },
			{ id: 'row-3', role: 'role-gitlab', managed_by: 'auth:gitlab', sort: null },
		];

		await syncProviderMemberships('user-1', 'github', ['role-a', 'role-b'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(createMany).toHaveBeenCalledWith([
			{ role: 'role-a', managed_by: 'auth:github', user: 'user-1', sort: 4 },
			{ role: 'role-b', managed_by: 'auth:github', user: 'user-1', sort: 5 },
		]);

		expect(deleteMany).not.toHaveBeenCalled();
	});

	test('writes nothing when the mapped role is already granted', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-a', managed_by: 'auth:github', sort: 1 },
		];

		await syncProviderMemberships('user-1', 'github', ['role-a'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(RoleMembersService).not.toHaveBeenCalled();
	});

	test('keeps a stored role its mapping spells in capitals', async () => {
		userRows = [
			{
				id: 'row-1',
				role: '3d9a4c17-6e2b-4f0a-9c1d-2b7e8f6a5c41',
				managed_by: 'auth:github',
				sort: 1,
			},
		];

		await syncProviderMemberships(
			'user-1',
			'github',
			['3D9A4C17-6E2B-4F0A-9C1D-2B7E8F6A5C41'],
			{ knex: knexMock, schema: {} as SchemaOverview },
		);

		expect(RoleMembersService).not.toHaveBeenCalled();
	});

	test('writes nothing when no role is mapped and none is granted', async () => {
		await syncProviderMemberships('user-1', 'github', [], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(RoleMembersService).not.toHaveBeenCalled();
	});

	test('only creates when a role is mapped and none is granted', async () => {
		await syncProviderMemberships('user-1', 'github', ['role-a'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).not.toHaveBeenCalled();

		expect(createMany).toHaveBeenCalledWith([
			{ role: 'role-a', managed_by: 'auth:github', user: 'user-1', sort: 1 },
		]);
	});

	test('deletes only the rows whose role is no longer mapped', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-a', managed_by: 'auth:github', sort: 1 },
			{ id: 'row-2', role: 'role-b', managed_by: 'auth:github', sort: 2 },
		];

		await syncProviderMemberships('user-1', 'github', ['role-b'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).toHaveBeenCalledWith(['row-1']);
		expect(createMany).not.toHaveBeenCalled();
	});

	test('writes nothing when the mapped roles come in another order', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-a', managed_by: 'auth:github', sort: 1 },
			{ id: 'row-2', role: 'role-b', managed_by: 'auth:github', sort: 2 },
		];

		await syncProviderMemberships('user-1', 'github', ['role-b', 'role-a'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(RoleMembersService).not.toHaveBeenCalled();
	});

	test('deletes a second row of a role still mapped', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-a', managed_by: 'auth:github', sort: 1 },
			{ id: 'row-2', role: 'role-a', managed_by: 'auth:github', sort: 2 },
		];

		await syncProviderMemberships('user-1', 'github', ['role-a'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).toHaveBeenCalledWith(['row-2']);
		expect(createMany).not.toHaveBeenCalled();
	});

	test('creates the new role before deleting the old one, in one trx', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-a', managed_by: 'auth:github', sort: 1 },
		];

		await syncProviderMemberships('user-1', 'github', ['role-b'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(transaction).toHaveBeenCalledOnce();

		expect(RoleMembersService).toHaveBeenCalledWith({
			knex: knexMock,
			schema: {},
		});

		expect(createMany).toHaveBeenCalledWith([
			{ role: 'role-b', managed_by: 'auth:github', user: 'user-1', sort: 2 },
		]);

		expect(deleteMany).toHaveBeenCalledWith(['row-1']);

		expect(createMany.mock.invocationCallOrder[0])
			.toBeLessThan(deleteMany.mock.invocationCallOrder[0]!);
	});

	test('only deletes when no role is mapped any more', async () => {
		userRows = [
			{ id: 'row-1', role: 'role-old', managed_by: 'auth:github', sort: 1 },
		];

		await syncProviderMemberships('user-1', 'github', [], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).toHaveBeenCalledWith(['row-1']);
		expect(createMany).not.toHaveBeenCalled();
	});

	test(oneLine`
		takes a conflict with a concurrent login holding the same rows as done
		work, rolled back to its savepoint
	`, async () => {
		const heldOnceError = new Error('held-once index');

		createMany.mockRejectedValueOnce(heldOnceError);

		vi.mocked(knexMock.where)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ role: 'ROLE-A' }]);

		await syncProviderMemberships('user-1', 'github', ['role-a'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(knexMock.rollback).toHaveBeenCalledOnce();
		expect(knexMock.commit).not.toHaveBeenCalled();

		expect(vi.mocked(knexMock.where).mock.calls).toEqual([
			[{ user: 'user-1' }],
			[{ user: 'user-1', managed_by: 'auth:github' }],
		]);
	});

	test('rethrows a failed create leaving a mapped role unheld', async () => {
		const createError = new Error('user limit reached');

		createMany.mockRejectedValueOnce(createError);

		vi.mocked(knexMock.where)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ role: 'role-a' }]);

		await expect(syncProviderMemberships(
			'user-1',
			'github',
			['role-a', 'role-b'],
			{ knex: knexMock, schema: {} as SchemaOverview },
		)).rejects.toBe(createError);

		expect(knexMock.rollback).toHaveBeenCalledOnce();
	});

	test('commits the savepoint of a create that lands', async () => {
		await syncProviderMemberships('user-1', 'github', ['role-a'], {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(knexMock.transaction).toHaveBeenCalledOnce();
		expect(knexMock.commit).toHaveBeenCalledOnce();
		expect(knexMock.rollback).not.toHaveBeenCalled();
	});
});
