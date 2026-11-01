import { filterItems } from './filter-items.js';
import { appAccessMinimalPermissions } from '@directus/system-data';
import { describe, test, expect } from 'vitest';

const items = [
	{
		role: '9bc9fea0-f761-4107-bfb7-b3d06c125e98',
		permissions: {},
		validation: null,
		presets: null,
		fields: ['*'],
		system: true,
		collection: 'directus_settings',
		action: 'read',
	},
	{
		role: '9bc9fea0-f761-4107-bfb7-b3d06c125e98',
		permissions: {
			user: {
				_eq: '$CURRENT_USER',
			},
		},
		validation: null,
		presets: null,
		fields: ['*'],
		system: true,
		collection: 'directus_presets',
		action: 'delete',
	},
];

describe('filter items', () => {
	test('return items when no filter', () => {
		const result = filterItems(items, undefined);
		expect(result).toStrictEqual(items);
	});

	test('return items when empty filter used', () => {
		const result = filterItems(items, {});
		expect(result).toStrictEqual(items);
	});

	test('return filtered items when nested empty filter used', () => {
		const result = filterItems(items, {
			_and: [
				{
					action: {
						_eq: 'read',
					},
				},
				{},
			],
		});

		expect(result).toStrictEqual(items.filter((item) => item.action === 'read'));
	});

	test('return filtered items', () => {
		const result = filterItems(items, {
			action: {
				_eq: 'read',
			},
		});

		expect(result).toStrictEqual(items.filter((item) => item.action === 'read'));
	});
});

describe('a filter naming a field the item lacks', () => {
	test('drops the item, whatever the operator', () => {
		const result = filterItems(
			[
				{ id: 41, collection: 'directus_users', action: 'read' },
				{ collection: 'directus_fields', action: 'read', policy: null },
			],
			{ id: { _in: [41, 42] } },
		);

		expect(result).toStrictEqual([
			{ id: 41, collection: 'directus_users', action: 'read' },
		]);
	});

	test('drops the item on a negative operator too', () => {
		const result = filterItems(
			[{ collection: 'directus_fields', action: 'read', policy: null }],
			{ id: { _nnull: true } },
		);

		expect(result).toStrictEqual([]);
	});

	test('drops the item on a relational filter', () => {
		const result = filterItems(
			[
				{ collection: 'directus_fields', policy: { name: 'editors' } },
				{ collection: 'directus_relations' },
			],
			{ policy: { name: { _eq: 'editors' } } },
		);

		expect(result).toStrictEqual([
			{ collection: 'directus_fields', policy: { name: 'editors' } },
		]);
	});

	test('drops the item when the nested field is the absent one', () => {
		const result = filterItems(
			[{ collection: 'directus_fields', policy: { id: 'editors' } }],
			{ policy: { name: { _nnull: true } } },
		);

		expect(result).toStrictEqual([]);
	});

	test('keeps composing under _or', () => {
		const result = filterItems(
			[
				{ id: 41, collection: 'directus_users' },
				{ collection: 'directus_fields' },
				{ collection: 'directus_relations' },
			],
			{
				_or: [
					{ id: { _eq: 41 } },
					{ collection: { _eq: 'directus_fields' } },
				],
			},
		);

		expect(result).toStrictEqual([
			{ id: 41, collection: 'directus_users' },
			{ collection: 'directus_fields' },
		]);
	});

	test('drops every app minimal permission on an id filter', () => {
		const result = filterItems(appAccessMinimalPermissions, {
			id: { _in: [41, 42] },
		});

		expect(result).toStrictEqual([]);
	});
});

describe('a filter naming a field present as null', () => {
	test('keeps the item on _null', () => {
		const result = filterItems(
			[{ collection: 'directus_fields', policy: null }],
			{ policy: { _null: true } },
		);

		expect(result).toStrictEqual([
			{ collection: 'directus_fields', policy: null },
		]);
	});

	test('drops the item on _in', () => {
		const result = filterItems(
			[{ collection: 'directus_fields', policy: null }],
			{ policy: { _in: ['editors'] } },
		);

		expect(result).toStrictEqual([]);
	});

	test('drops the item on a relational filter', () => {
		const result = filterItems(
			[{ collection: 'directus_fields', policy: null }],
			{ policy: { name: { _eq: 'editors' } } },
		);

		expect(result).toStrictEqual([]);
	});
});
