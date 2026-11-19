import type { Accountability, Permission, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import {
	fetchPermittedAstRootFields,
} from '../../database/run-ast/modules/fetch-permitted-ast-root-fields.js';
import { fetchPermissions } from './fetch-permissions.js';
import { fetchPolicyAccessRows } from './fetch-policies.js';
import { fetchRolesTree } from './fetch-roles-tree.js';
import { fetchRawPermissions } from '../utils/fetch-raw-permissions.js';
import {
	fetchGlobalAccessForRoles,
} from '../modules/fetch-global-access/lib/fetch-global-access-for-roles.js';
import { fetchAllowingMemberRoles } from './fetch-allowing-member-roles.js';

vi.mock('../../database/run-ast/modules/fetch-permitted-ast-root-fields.js');
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
		{ accountability, action: 'create', collection: 'articles', primaryKeys: [] },
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
		{ policy: 'policy-staff' },
		{ policy: null },
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
		{ accountability, action: 'create', collection: 'articles', primaryKeys: [] },
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
		{ policy: 'policy-user' },
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
		{ accountability, action: 'create', collection: 'articles', primaryKeys: [] },
		{ knex, schema },
	)).resolves.toEqual([]);
});

test('leaves out the role whose update rule misses a written row', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
		{ policy: { id: 'policy-reviewers', ip_access: null }, role: 'reviewers' },
	]);

	vi.mocked(fetchPermissions).mockResolvedValue([
		{ policy: 'policy-editors', permissions: { status: { _eq: 'draft' } } },
		{ policy: 'policy-reviewers', permissions: {} },
		{ policy: null, permissions: { status: { _eq: 'draft' } } },
	] as Permission[]);

	vi.mocked(fetchPermittedAstRootFields).mockResolvedValue([]);

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
		{ accountability, action: 'update', collection: 'articles', primaryKeys: [7] },
		{ knex, schema },
	)).resolves.toEqual(['reviewers']);

	expect(fetchPermissions).toHaveBeenCalledWith(
		{
			action: 'update',
			policies: ['policy-editors', 'policy-reviewers'],
			collections: ['articles'],
			accountability,
		},
		{ knex, schema },
	);

	expect(fetchPermittedAstRootFields).toHaveBeenCalledTimes(1);

	expect(fetchPermittedAstRootFields).toHaveBeenCalledWith(
		{
			type: 'root',
			name: 'articles',
			query: { limit: 1, filter: { id: { _in: [7] } } },
			children: [],
			cases: [{ status: { _eq: 'draft' } }],
		},
		{ schema, accountability, knex, action: 'update' },
	);
});

test('keeps the role whose update rule matches every written row', async () => {
	vi.mocked(fetchPolicyAccessRows).mockResolvedValue([
		{ policy: { id: 'policy-editors', ip_access: null }, role: 'editors' },
	]);

	vi.mocked(fetchPermissions).mockResolvedValue([
		{ policy: 'policy-editors', permissions: { status: { _eq: 'draft' } } },
	] as unknown as Permission[]);

	vi.mocked(fetchPermittedAstRootFields).mockResolvedValue([
		{ id: 7 },
		{ id: 8 },
	]);

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
		},
		{ knex, schema },
	)).resolves.toEqual(['editors']);
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
		{ accountability, action: 'update', collection: 'articles', primaryKeys: [] },
		{ knex, schema },
	)).rejects.toEqual(new Error(
		'An update of "articles" names no row to check the permissions of',
	));

	expect(fetchPermissions).not.toHaveBeenCalled();
});
