import type { Accountability, Permission, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { getDBQuery } from '../../database/run-ast/lib/get-db-query.js';
import { fetchPermissions } from './fetch-permissions.js';
import { fetchPolicies, fetchPolicyAccessRows } from './fetch-policies.js';
import { fetchRolesTree } from './fetch-roles-tree.js';
import { fetchRawPermissions } from '../utils/fetch-raw-permissions.js';
import {
	fetchGlobalAccessForRoles,
} from '../modules/fetch-global-access/lib/fetch-global-access-for-roles.js';
import {
	fetchAllowingMemberRoles,
	fetchAllowingMemberRolesByRow,
} from './fetch-allowing-member-roles.js';

vi.mock('../../database/run-ast/lib/get-db-query.js');
vi.mock('./fetch-permissions.js');
vi.mock('./fetch-policies.js');
vi.mock('./fetch-roles-tree.js');
vi.mock('../utils/fetch-raw-permissions.js');
vi.mock('../modules/fetch-global-access/lib/fetch-global-access-for-roles.js');

const knex = {} as Knex;

const schema = {
	collections: { articles: { primary: 'id' } },
} as unknown as SchemaOverview;

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetAllMocks();
});

test('gives an admin the member roles granting admin access', async () => {
	vi.mocked(fetchRolesTree)
		.mockResolvedValueOnce(['editors'])
		.mockResolvedValueOnce(['root', 'staff-admin']);

	vi.mocked(fetchGlobalAccessForRoles)
		.mockResolvedValueOnce({ admin: false, app: true, grantedDbConnections: [] })
		.mockResolvedValueOnce({ admin: true, app: true, grantedDbConnections: [] });

	const accountability = {
		user: 'user-1',
		admin: true,
		memberRoles: ['editors', 'staff-admin'],
		ip: '127.0.0.1',
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'create',
			collection: 'articles',
			primaryKeys: [],
			fields: ['label'],
		},
		{ knex, schema },
	)).resolves.toEqual(['staff-admin']);

	expect(fetchRolesTree).toHaveBeenNthCalledWith(1, 'editors', knex);
	expect(fetchRolesTree).toHaveBeenNthCalledWith(2, 'staff-admin', knex);

	expect(fetchGlobalAccessForRoles).toHaveBeenNthCalledWith(
		1,
		{ roles: ['editors'], ip: '127.0.0.1' },
		knex,
	);

	expect(fetchGlobalAccessForRoles).toHaveBeenNthCalledWith(
		2,
		{ roles: ['root', 'staff-admin'], ip: '127.0.0.1' },
		knex,
	);

	expect(fetchPolicyAccessRows).not.toHaveBeenCalled();
});

test('counts an inherited create policy as the member role', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-staff', ip_access: null }, role: 'staff' },
		{ policy: { id: 'policy-guests', ip_access: null }, role: 'guests' },
		{ policy: { id: 'policy-user', ip_access: null }, role: null },
	]);

	vi.mocked(fetchRawPermissions).mockResolvedValue([
		{ policy: 'policy-staff', fields: ['*'] },
		{ policy: null, fields: ['*'] },
	] as Permission[]);

	vi.mocked(fetchRolesTree)
		.mockResolvedValueOnce(['staff', 'editors'])
		.mockResolvedValueOnce(['guests']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors', 'guests'],
		roles: ['staff', 'editors', 'guests'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'create',
			collection: 'articles',
			primaryKeys: [],
			fields: ['label'],
		},
		{ knex, schema },
	)).resolves.toEqual(['editors']);

	expect(fetchPolicyAccessRows).toHaveBeenCalledWith(accountability, {
		knex,
		schema,
	});

	expect(fetchRawPermissions).toHaveBeenCalledWith(
		{
			action: 'create',
			policies: ['policy-staff', 'policy-guests', 'policy-user'],
			collections: ['articles'],
			accountability,
			bypassMinimalAppPermissions: false,
		},
		{ knex, schema },
	);
});

test('gives no role for a create allowed by a policy of the user', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-user', ip_access: null }, role: null },
	]);

	vi.mocked(fetchRawPermissions).mockResolvedValue([
		{ policy: 'policy-user', fields: ['*'] },
	] as Permission[]);

	vi.mocked(fetchRolesTree).mockResolvedValueOnce(['editors']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors'],
		roles: ['editors'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'create',
			collection: 'articles',
			primaryKeys: [],
			fields: ['label'],
		},
		{ knex, schema },
	)).resolves.toEqual([]);
});

test('leaves out a role whose create sets none of the fields', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
		{ policy: { id: 'policy-reviewers', ip_access: null }, role: 'reviewers' },
	]);

	vi.mocked(fetchRawPermissions).mockResolvedValue([
		{ policy: 'policy-editors', fields: ['label'] },
		{ policy: 'policy-reviewers', fields: ['note'] },
	] as Permission[]);

	vi.mocked(fetchRolesTree)
		.mockResolvedValueOnce(['editors'])
		.mockResolvedValueOnce(['reviewers']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors', 'reviewers'],
		roles: ['editors', 'reviewers'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'create',
			collection: 'articles',
			primaryKeys: [],
			fields: ['label', 'status'],
		},
		{ knex, schema },
	)).resolves.toEqual(['editors']);
});

test('leaves out the role whose update rule misses a written row', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
		{ policy: { id: 'policy-reviewers', ip_access: null }, role: 'reviewers' },
	]);

	vi.mocked(fetchPolicies).mockResolvedValue([
		'policy-editors',
		'policy-reviewers',
	]);

	const updatePermissions = [
		{
			policy: 'policy-editors',
			fields: ['*'],
			permissions: { status: { _eq: 'draft' } },
		},
		{ policy: 'policy-reviewers', fields: ['*'], permissions: {} },
		{
			policy: null,
			fields: ['*'],
			permissions: { status: { _eq: 'draft' } },
		},
	] as Permission[];

	vi.mocked(fetchPermissions).mockResolvedValue(updatePermissions);
	vi.mocked(getDBQuery).mockResolvedValue([] as never);

	vi.mocked(fetchRolesTree)
		.mockResolvedValueOnce(['editors'])
		.mockResolvedValueOnce(['reviewers']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors', 'reviewers'],
		roles: ['editors', 'reviewers'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'update',
			collection: 'articles',
			primaryKeys: [7],
			fields: ['label'],
		},
		{ knex, schema },
	)).resolves.toEqual(['reviewers']);

	expect(fetchPermissions).toHaveBeenNthCalledWith(
		1,
		{
			action: 'update',
			policies: ['policy-editors', 'policy-reviewers'],
			collections: ['articles'],
			accountability,
		},
		{ knex, schema },
	);

	expect(fetchPermissions).toHaveBeenNthCalledWith(
		2,
		{
			action: 'update',
			accountability,
			policies: ['policy-editors', 'policy-reviewers'],
		},
		{ knex, schema },
	);

	expect(getDBQuery).toHaveBeenCalledTimes(1);

	expect(getDBQuery).toHaveBeenCalledWith(
		{
			table: 'articles',
			fieldNodes: [{
				type: 'field',
				name: 'id',
				fieldKey: 'id',
				whenCase: [],
				alias: false,
			}],
			o2mNodes: [],
			query: { limit: 1, filter: { id: { _in: [7] } } },
			cases: [{ status: { _eq: 'draft' } }],
			permissions: updatePermissions,
		},
		{ knex, schema },
	);
});

test('keeps the role whose update rule matches every written row', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
	]);

	vi.mocked(fetchPermissions).mockResolvedValue([
		{
			policy: 'policy-editors',
			fields: ['*'],
			permissions: { status: { _eq: 'draft' } },
		},
	] as unknown as Permission[]);

	vi.mocked(getDBQuery).mockResolvedValue([{ id: 7 }, { id: 8 }] as never);
	vi.mocked(fetchRolesTree).mockResolvedValueOnce(['editors']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors'],
		roles: ['editors'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'update',
			collection: 'articles',
			primaryKeys: [7, 8],
			fields: ['label'],
		},
		{ knex, schema },
	)).resolves.toEqual(['editors']);
});

test('gives each written row the roles whose update rule matches it', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
		{ policy: { id: 'policy-reviewers', ip_access: null }, role: 'reviewers' },
	]);

	vi.mocked(fetchPermissions).mockResolvedValue([
		{
			policy: 'policy-editors',
			fields: ['*'],
			permissions: { status: { _eq: 'draft' } },
		},
		{
			policy: 'policy-reviewers',
			fields: ['*'],
			permissions: { status: { _eq: 'review' } },
		},
	] as unknown as Permission[]);

	vi.mocked(getDBQuery)
		.mockResolvedValueOnce([{ id: 1 }] as never)
		.mockResolvedValueOnce([{ id: 2 }] as never);

	vi.mocked(fetchRolesTree)
		.mockResolvedValueOnce(['editors'])
		.mockResolvedValueOnce(['reviewers']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors', 'reviewers'],
		roles: ['editors', 'reviewers'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRolesByRow(
		{
			accountability,
			action: 'update',
			collection: 'articles',
			primaryKeys: [1, 2],
			fields: ['label'],
		},
		{ knex, schema },
	)).resolves.toEqual(new Map([
		['1', ['editors']],
		['2', ['reviewers']],
	]));

	expect(getDBQuery).toHaveBeenCalledTimes(2);
});

test('leaves out a role whose update sets none of the fields', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
		{ policy: { id: 'policy-reviewers', ip_access: null }, role: 'reviewers' },
	]);

	vi.mocked(fetchPermissions).mockResolvedValue([
		{ policy: 'policy-editors', fields: ['label'], permissions: {} },
		{ policy: 'policy-reviewers', fields: ['note'], permissions: {} },
	] as unknown as Permission[]);

	vi.mocked(fetchRolesTree)
		.mockResolvedValueOnce(['editors'])
		.mockResolvedValueOnce(['reviewers']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors', 'reviewers'],
		roles: ['editors', 'reviewers'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRolesByRow(
		{
			accountability,
			action: 'update',
			collection: 'articles',
			primaryKeys: [1],
			fields: ['note'],
		},
		{ knex, schema },
	)).resolves.toEqual(new Map([['1', ['reviewers']]]));

	expect(getDBQuery).not.toHaveBeenCalled();
});

test('refuses an update naming no row', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([]);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors'],
		roles: ['editors'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRoles(
		{
			accountability,
			action: 'update',
			collection: 'articles',
			primaryKeys: [],
			fields: ['label'],
		},
		{ knex, schema },
	)).rejects.toEqual(new Error(
		'An update of "articles" names no row to check the permissions of',
	));

	expect(fetchPermissions).not.toHaveBeenCalled();
});

test('matches a uuid key sent in capitals to the row read back', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
	]);

	vi.mocked(fetchPermissions).mockResolvedValue([
		{
			policy: 'policy-editors',
			fields: ['*'],
			permissions: { status: { _eq: 'draft' } },
		},
	] as unknown as Permission[]);

	vi.mocked(getDBQuery).mockResolvedValueOnce([
		{ id: 'a1b2c3d4-0000-4000-8000-00000000000f' },
	] as never);

	vi.mocked(fetchRolesTree).mockResolvedValueOnce(['editors']);

	const accountability = {
		user: 'user-1',
		admin: false,
		memberRoles: ['editors'],
		roles: ['editors'],
		ip: null,
	} as unknown as Accountability;

	await expect(fetchAllowingMemberRolesByRow(
		{
			accountability,
			action: 'update',
			collection: 'articles',
			primaryKeys: ['A1B2C3D4-0000-4000-8000-00000000000F'],
			fields: ['label'],
		},
		{
			knex,
			schema: {
				collections: {
					articles: {
						primary: 'id',
						fields: { id: { type: 'uuid' } },
					},
				},
			} as unknown as SchemaOverview,
		},
	)).resolves.toEqual(new Map([
		['A1B2C3D4-0000-4000-8000-00000000000F', ['editors']],
	]));
});
