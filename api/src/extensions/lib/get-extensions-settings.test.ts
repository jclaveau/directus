import { afterEach, expect, test, vi } from 'vitest';
import { getExtensionsSettings } from './get-extensions-settings.js';

const itemsMocks = vi.hoisted(() => {
	return {
		readByQuery: vi.fn(),
		deleteMany: vi.fn(),
		createMany: vi.fn(),
	};
});

vi.mock('../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('@directus/extensions-registry', () => ({ list: vi.fn() }));

vi.mock('../../services/extensions.js', () => {
	return {
		ExtensionsService: class {
			extensionsItemService = itemsMocks;
		},
	};
});

afterEach(() => {
	vi.resetAllMocks();
});

test('keeps every entry row of a code bundle past its api entries', async () => {
	itemsMocks.readByQuery.mockResolvedValue([
		{ id: 'bundle-id', source: 'module', folder: 'orders', bundle: null },
		{ id: 'picker-id', source: 'module', folder: 'picker', bundle: 'bundle-id' },
		{ id: 'audit-id', source: 'module', folder: 'audit', bundle: 'bundle-id' },
	]);

	const ordersBundle = {
		type: 'bundle',
		name: 'orders',
		entriesFrom: 'code',
		entries: [{ type: 'hook', name: 'audit' }],
	};

	const settings = await getExtensionsSettings({
		module: new Map([['orders', ordersBundle]]) as never,
		registry: new Map(),
	});

	expect(itemsMocks.deleteMany).not.toHaveBeenCalled();
	expect(itemsMocks.createMany).not.toHaveBeenCalled();

	expect(settings).toEqual([
		{ id: 'bundle-id', source: 'module', folder: 'orders', bundle: null },
		{ id: 'picker-id', source: 'module', folder: 'picker', bundle: 'bundle-id' },
		{ id: 'audit-id', source: 'module', folder: 'audit', bundle: 'bundle-id' },
	]);

	expect(ordersBundle.entries).toEqual([{ type: 'hook', name: 'audit' }]);
});

test('creates the rows of a new code bundle without an entry type', async () => {
	itemsMocks.readByQuery.mockResolvedValue([]);

	await getExtensionsSettings({
		module: new Map([
			[
				'orders',
				{
					type: 'bundle',
					name: 'orders',
					entriesFrom: 'code',
					entries: [{ type: 'hook', name: 'audit' }],
				},
			],
		]) as never,
		registry: new Map(),
	});

	expect(itemsMocks.createMany).toHaveBeenCalledWith([
		{
			id: expect.any(String),
			enabled: true,
			source: 'module',
			bundle: null,
			folder: 'orders',
		},
		{
			id: expect.any(String),
			enabled: true,
			source: 'module',
			bundle: expect.any(String),
			folder: 'audit',
		},
	]);
});
