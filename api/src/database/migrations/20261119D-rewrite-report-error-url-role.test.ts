import { systemFieldRows } from '@directus/system-data';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { down, up } from './20261119D-rewrite-report-error-url-role.js';

test('the report_error_url picker offers the member roles, not a role', () => {
	const reportErrorUrlField = systemFieldRows.find(({ collection, field }) => {
		return collection === 'directus_settings' && field === 'report_error_url';
	});

	expect(reportErrorUrlField?.options?.['fields'].at(-1)).toEqual({
		name: 'Roles',
		field: 'roles',
		key: 'roles',
		path: 'roles',
		children: [
			{
				name: 'ID',
				field: 'id',
				key: 'roles[0].id',
				path: 'roles[0].id',
			},
			{
				name: 'Name',
				field: 'name',
				key: 'roles[0].name',
				path: 'roles[0].name',
			},
		],
	});
});

describe('the migration', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
	});

	test('up reads the first role where a template read the role', async () => {
		tracker.on.select('directus_settings').response([
			{
				id: 1,
				report_error_url: 'https://bugs.example.com/new?role={{role.name}}'
					+ '&id={{ role.id }}&user={{user.id}}',
			},
			{ id: 2, report_error_url: 'https://bugs.example.com/new' },
		]);

		tracker.on.update('directus_settings').response(1);

		await up(db);

		expect(tracker.history.update.map(({ bindings }) => bindings)).toEqual([
			[
				'https://bugs.example.com/new?role={{roles[0].name}}'
				+ '&id={{roles[0].id}}&user={{user.id}}',
				1,
			],
		]);
	});

	test('down reads the role where a template read the first role', async () => {
		tracker.on.select('directus_settings').response([
			{
				id: 1,
				report_error_url: 'https://bugs.example.com/new?role={{roles[0].name}}',
			},
		]);

		tracker.on.update('directus_settings').response(1);

		await down(db);

		expect(tracker.history.update.map(({ bindings }) => bindings)).toEqual([
			['https://bugs.example.com/new?role={{role.name}}', 1],
		]);
	});

	test('down refuses a template one role cannot hold, writing nothing', async () => {
		tracker.on.select('directus_settings').response([
			{
				id: 1,
				report_error_url: 'https://bugs.example.com/new?role={{roles[0].name}}',
			},
			{
				id: 2,
				report_error_url: 'https://bugs.example.com/new?second={{roles[1].name}}'
					+ '&all={{roles}}',
			},
		]);

		await expect(down(db)).rejects.toThrow(new Error(
			'Cannot roll back the multi-role migration: directus_settings row 2'
			+ ' "report_error_url" reads "{{roles[1].name}}", "{{roles}}", which'
			+ ' one role cannot hold; replace them by hand first',
		));

		expect(tracker.history.update).toEqual([]);
	});
});
