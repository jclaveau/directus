import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RoleMembersService } from '../../services/role-members.js';
import {
	providerMemberships,
	syncProviderMemberships,
	takeProviderRole,
} from './provider-memberships.js';

vi.mock('../../services/role-members.js');

afterEach(() => {
	vi.restoreAllMocks();
});

describe('takeProviderRole', () => {
	test('moves role out of the payload', () => {
		expect(takeProviderRole({ email: 'a@b.c', role: 'role-a' })).toEqual({
			userPayload: { email: 'a@b.c' },
			providerRole: 'role-a',
		});
	});

	test('keeps a null role as null', () => {
		expect(takeProviderRole({ email: 'a@b.c', role: null })).toEqual({
			userPayload: { email: 'a@b.c' },
			providerRole: null,
		});
	});

	test('returns undefined when the payload names no role', () => {
		expect(takeProviderRole({ email: 'a@b.c' })).toEqual({
			userPayload: { email: 'a@b.c' },
			providerRole: undefined,
		});
	});
});

describe('providerMemberships', () => {
	test('gives one membership managed by the provider', () => {
		expect(providerMemberships('github', 'role-a')).toEqual([
			{ role: 'role-a', managed_by: 'auth:github' },
		]);
	});

	test('gives none for a null role', () => {
		expect(providerMemberships('github', null)).toEqual([]);
	});

	test('gives none for an undefined role', () => {
		expect(providerMemberships('github', undefined)).toEqual([]);
	});
});

describe('syncProviderMemberships', () => {
	let knexMock: Knex;
	let managedRows: { id: string; role: string }[];
	let whereMock: ReturnType<typeof vi.fn>;
	let deleteMany: ReturnType<typeof vi.fn>;
	let createMany: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		managedRows = [];
		deleteMany = vi.fn();
		createMany = vi.fn();

		vi.mocked(RoleMembersService).mockImplementation(function () {
			return { deleteMany, createMany } as any;
		});

		whereMock = vi.fn().mockImplementation(async () => managedRows);

		knexMock = {
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: whereMock,
		} as unknown as Knex;
	});

	test('reads only the rows managed by the provider of the user', async () => {
		await syncProviderMemberships('user-1', 'github', null, {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(knexMock.select).toHaveBeenCalledWith('id', 'role');
		expect(knexMock.from).toHaveBeenCalledWith('directus_role_members');

		expect(whereMock).toHaveBeenCalledWith({
			user: 'user-1',
			managed_by: 'auth:github',
		});
	});

	test('writes nothing when the same role is already granted', async () => {
		managedRows = [{ id: 'row-1', role: 'role-a' }];

		await syncProviderMemberships('user-1', 'github', 'role-a', {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(RoleMembersService).not.toHaveBeenCalled();
		expect(deleteMany).not.toHaveBeenCalled();
		expect(createMany).not.toHaveBeenCalled();
	});

	test('writes nothing when no role is mapped and none is granted', async () => {
		await syncProviderMemberships('user-1', 'github', null, {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(RoleMembersService).not.toHaveBeenCalled();
	});

	test('only creates when a role is mapped and none is granted', async () => {
		await syncProviderMemberships('user-1', 'github', 'role-a', {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).not.toHaveBeenCalled();

		expect(createMany).toHaveBeenCalledWith([
			{ role: 'role-a', managed_by: 'auth:github', user: 'user-1' },
		]);
	});

	test('replaces the granted role by the newly mapped one', async () => {
		managedRows = [{ id: 'row-1', role: 'role-old' }];

		await syncProviderMemberships('user-1', 'github', 'role-new', {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).toHaveBeenCalledWith(['row-1']);

		expect(createMany).toHaveBeenCalledWith([
			{ role: 'role-new', managed_by: 'auth:github', user: 'user-1' },
		]);
	});

	test('only deletes when the mapped role is removed', async () => {
		managedRows = [{ id: 'row-1', role: 'role-old' }];

		await syncProviderMemberships('user-1', 'github', null, {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).toHaveBeenCalledWith(['row-1']);
		expect(createMany).not.toHaveBeenCalled();
	});

	test('replaces every row when the provider holds several', async () => {
		managedRows = [
			{ id: 'row-1', role: 'role-a' },
			{ id: 'row-2', role: 'role-b' },
		];

		await syncProviderMemberships('user-1', 'github', 'role-a', {
			knex: knexMock,
			schema: {} as SchemaOverview,
		});

		expect(deleteMany).toHaveBeenCalledWith(['row-1', 'row-2']);

		expect(createMany).toHaveBeenCalledWith([
			{ role: 'role-a', managed_by: 'auth:github', user: 'user-1' },
		]);
	});
});
