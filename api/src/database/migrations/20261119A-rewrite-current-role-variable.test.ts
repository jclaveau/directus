import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
	down,
	findCurrentRole,
	restoreCurrentRole,
	rewriteCurrentRole,
	up,
} from './20261119A-rewrite-current-role-variable.js';

describe('rewriteCurrentRole', () => {
	test.each([
		[
			{ role: { _eq: '$CURRENT_ROLE' } },
			{ role: { _in: '$CURRENT_MEMBER_ROLES' } },
		],
		[
			{ role: { _neq: '$CURRENT_ROLE' } },
			{ role: { _nin: '$CURRENT_MEMBER_ROLES' } },
		],
		[
			{ _or: [{ role: { _eq: '$CURRENT_ROLE' } }, { role: { _null: true } }] },
			{
				_or: [
					{ role: { _in: '$CURRENT_MEMBER_ROLES' } },
					{ role: { _null: true } },
				],
			},
		],
		[{ role_tag: '$CURRENT_ROLE' }, { role_tag: '$CURRENT_ROLE' }],
		[
			{ role: { name: { _eq: '$CURRENT_ROLE.name' } } },
			{ role: { name: { _eq: '$CURRENT_ROLE.name' } } },
		],
		[
			{ role: { _in: ['$CURRENT_ROLE'] } },
			{ role: { _in: ['$CURRENT_ROLE'] } },
		],
		[
			{ role: { _eq: '$CURRENT_ROLE' }, status: { _eq: 'draft' } },
			{ role: { _in: '$CURRENT_MEMBER_ROLES' }, status: { _eq: 'draft' } },
		],
	])('%j → %j', (stored, rewritten) => {
		expect(rewriteCurrentRole(stored)).toEqual(rewritten);
	});
});

test('restoreCurrentRole undoes the rewrite', () => {
	expect(restoreCurrentRole({
		_and: [
			{ role: { _in: '$CURRENT_MEMBER_ROLES' } },
			{ owner: { _nin: '$CURRENT_MEMBER_ROLES' } },
		],
	})).toEqual({
		_and: [
			{ role: { _eq: '$CURRENT_ROLE' } },
			{ owner: { _neq: '$CURRENT_ROLE' } },
		],
	});
});

describe('findCurrentRole', () => {
	test.each([
		[
			{ _and: [{ rank: { _gt: 2 } }, { role: { _eq: '$CURRENT_ROLE.name' } }] },
			'$CURRENT_ROLE.name',
		],
		[{ archived: { _null: true } }, null],
	])('%j → %j', (stored, removedVariable) => {
		expect(findCurrentRole(stored)).toEqual(removedVariable);
	});
});

describe('the migration', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
	});

	test('up rewrites a stored filter, as JSON text', async () => {
		tracker.on.select('directus_permissions').response([
			{
				id: 7,
				permissions: '{"role":{"_eq":"$CURRENT_ROLE"}}',
				validation: null,
				presets: null,
			},
		]);

		tracker.on.select(/directus_(presets|fields|operations|panels)/)
			.response([]);

		tracker.on.update('directus_permissions').response(1);

		await up(db);

		expect(tracker.history.update.map(({ bindings }) => bindings)).toEqual([
			['{"role":{"_in":"$CURRENT_MEMBER_ROLES"}}', 7],
		]);
	});

	test('up writes nothing for values without $CURRENT_ROLE', async () => {
		tracker.on.select('directus_permissions').response([
			{
				id: 8,
				permissions: '{"status":{"_eq":"draft"}}',
				validation: 'not json',
				presets: null,
			},
		]);

		tracker.on.select(/directus_(presets|fields|operations|panels)/)
			.response([]);

		await up(db);

		expect(tracker.history.update).toEqual([]);
	});

	test('up refuses, naming every value it cannot rewrite', async () => {
		tracker.on.select('directus_permissions').response([
			{
				id: 7,
				permissions: { role: { _eq: '$CURRENT_ROLE' } },
				validation: null,
				presets: { role_tag: '$CURRENT_ROLE' },
			},
		]);

		tracker.on.select('directus_presets').response([]);

		tracker.on.select('directus_fields').response([
			{
				id: 3,
				options: null,
				conditions: [{ rule: { role: { name: { _eq: '$CURRENT_ROLE.name' } } } }],
				validation: null,
			},
		]);

		tracker.on.select(/directus_(operations|panels)/).response([]);

		await expect(up(db)).rejects.toThrow(new Error(
			'"$CURRENT_ROLE" is removed (a user can hold several roles) and these'
			+ ' values have no "$CURRENT_MEMBER_ROLES" rewrite:'
			+ ' directus_permissions 7 "presets" uses "$CURRENT_ROLE";'
			+ ' directus_fields 3 "conditions" uses "$CURRENT_ROLE.name".'
			+ ' Replace each by hand, then run the migration again.',
		));

		expect(tracker.history.update).toEqual([]);
	});

	test('down restores $CURRENT_ROLE', async () => {
		tracker.on.select('directus_presets').response([
			{ id: 4, filter: { role: { _nin: '$CURRENT_MEMBER_ROLES' } } },
		]);

		tracker.on.select(/directus_(permissions|fields|operations|panels)/)
			.response([]);

		tracker.on.update('directus_presets').response(1);

		await down(db);

		expect(tracker.history.update.map(({ bindings }) => bindings)).toEqual([
			['{"role":{"_neq":"$CURRENT_ROLE"}}', 4],
		]);
	});
});
