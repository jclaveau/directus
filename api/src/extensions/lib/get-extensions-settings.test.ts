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

test('keeps the app entry rows of a code bundle in its entries', async () => {
	itemsMocks.readByQuery.mockResolvedValue([
		{ id: 'bundle-id', source: 'module', folder: 'orders', bundle: null },
		{
			id: 'picker-id',
			source: 'module',
			folder: 'picker',
			bundle: 'bundle-id',
			type: 'interface',
		},
		{
			id: 'audit-id',
			source: 'module',
			folder: 'audit',
			bundle: 'bundle-id',
			type: 'hook',
		},
		{
			id: 'removed-id',
			source: 'module',
			folder: 'removed-hook',
			bundle: 'bundle-id',
			type: 'hook',
		},
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

	expect(itemsMocks.deleteMany).toHaveBeenCalledWith(['removed-id']);
	expect(itemsMocks.createMany).not.toHaveBeenCalled();

	expect(settings).toEqual([
		{ id: 'bundle-id', source: 'module', folder: 'orders', bundle: null },
		{
			id: 'picker-id',
			source: 'module',
			folder: 'picker',
			bundle: 'bundle-id',
			type: 'interface',
		},
		{
			id: 'audit-id',
			source: 'module',
			folder: 'audit',
			bundle: 'bundle-id',
			type: 'hook',
		},
	]);

	expect(ordersBundle.entries).toEqual([
		{ type: 'hook', name: 'audit' },
		{ type: 'interface', name: 'picker' },
	]);
});

test('adds no app entry to a code bundle without a bundle row', async () => {
	itemsMocks.readByQuery.mockResolvedValue([
		{
			id: 'entry-id',
			source: 'registry',
			folder: 'orders',
			bundle: 'other-bundle-id',
			type: 'hook',
		},
	]);

	const ordersBundle = {
		type: 'bundle',
		name: 'orders',
		entriesFrom: 'code',
		entries: [],
	};

	const settings = await getExtensionsSettings({
		module: new Map(),
		registry: new Map([['orders', ordersBundle]]) as never,
	});

	expect(settings).toEqual([
		{
			id: 'entry-id',
			source: 'registry',
			folder: 'orders',
			bundle: 'other-bundle-id',
			type: 'hook',
		},
	]);

	expect(ordersBundle.entries).toEqual([]);
});
