import { oneLine } from '@directus/utils';
import type { Knex } from 'knex';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchGlobalAccessForQuery } from './fetch-global-access-for-query.js';

let qb: Knex.QueryBuilder;

beforeEach(() => {
	vi.clearAllMocks();

	qb = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		leftJoin: vi.fn().mockResolvedValue([]),
	} as unknown as Knex.QueryBuilder;
});

test('Returns false by default if no access is found', async () => {
	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({
		app: false,
		admin: false,
		grantedDbConnections: [],
	});
});

test('Sets app true if one or more access rows have app access set as true', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: false, app_access: false },
		{ admin_access: false, app_access: true },
		{ admin_access: false, app_access: false },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({ admin: false, app: true, grantedDbConnections: [] });
});

test('Sets admin & app true if one or more access rows have app admin set as true', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: false, app_access: false },
		{ admin_access: true, app_access: false },
		{ admin_access: false, app_access: false },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({ admin: true, app: true, grantedDbConnections: [] });
});

test('Sets app true if one or more access rows have app access set as 1', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: 0, app_access: 0 },
		{ admin_access: 0, app_access: 1 },
		{ admin_access: 0, app_access: 0 },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({ admin: false, app: true, grantedDbConnections: [] });
});

test('Sets admin & app true if one or more access rows have app admin set as true', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: 0, app_access: 0 },
		{ admin_access: 1, app_access: 0 },
		{ admin_access: 0, app_access: 0 },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({ admin: true, app: true, grantedDbConnections: [] });
});

test('Includes policies that have an ip access restriction that does matches the accountability ip', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: false, app_access: false },
		{ admin_access: false, app_access: true, ip_access: '127.0.0.1/24,127.0.0.2' },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: '127.0.0.5' });

	expect(res).toEqual({ admin: false, app: true, grantedDbConnections: [] });
});

test('Ignores policies that have an ip access restriction that does not match the accountability ip', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: false, app_access: false },
		{ admin_access: true, app_access: false, ip_access: '127.0.0.1,127.0.0.2' },
		{ admin_access: false, app_access: true, ip_access: '128.0.0.1' },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: '1.1.1.1' });

	expect(res).toEqual({ admin: false, app: false, grantedDbConnections: [] });
});

test(oneLine`
	Unions db_connections across policies, splitting CSV and deduping
`, async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: false, app_access: false, db_connections: 'premium' },
		{
			admin_access: false,
			app_access: false,
			db_connections: 'premium,replica_a',
		},
		{ admin_access: false, app_access: false, db_connections: null },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({
		admin: false,
		app: false,
		grantedDbConnections: ['premium', 'replica_a'],
	});
});

test('Ignores db_connections from policies filtered out by ip access', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: false, app_access: false, db_connections: 'allowed_pool' },
		{
			admin_access: false,
			app_access: false,
			db_connections: 'blocked_pool',
			ip_access: '128.0.0.1',
		},
	]);

	const res = await fetchGlobalAccessForQuery(qb, {
		ip: '1.1.1.1',
	});

	expect(res).toEqual({
		admin: false,
		app: false,
		grantedDbConnections: ['allowed_pool'],
	});
});

test(oneLine`
	Collects db_connections from policies after the admin policy, despite the
	admin short-circuit
`, async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{ admin_access: true, app_access: false, db_connections: null },
		{ admin_access: false, app_access: false, db_connections: 'premium' },
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({
		admin: true,
		app: true,
		grantedDbConnections: ['premium'],
	});
});

test('Trims whitespace around CSV db_connections names', async () => {
	vi.mocked(qb.leftJoin).mockResolvedValue([
		{
			admin_access: false,
			app_access: false,
			db_connections: 'premium, replica_a',
		},
	]);

	const res = await fetchGlobalAccessForQuery(qb, { ip: null });

	expect(res).toEqual({
		admin: false,
		app: false,
		grantedDbConnections: ['premium', 'replica_a'],
	});
});
