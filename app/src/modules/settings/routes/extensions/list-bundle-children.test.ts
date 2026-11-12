import { expect, test } from 'vitest';
import { listBundleChildren } from './list-bundle-children';

test('lists the entry rows of a bundle listing its entries', () => {
	expect(
		listBundleChildren(
			{
				id: 'bundle-id',
				bundle: null,
				schema: { type: 'bundle', entries: [] },
				meta: { enabled: true, source: 'module', folder: 'orders' },
			} as any,
			[
				{
					id: 'chart-id',
					bundle: 'bundle-id',
					schema: { type: 'panel', name: 'chart' },
					meta: { enabled: true, folder: 'chart' },
				},
				{
					id: 'other-id',
					bundle: 'other-bundle-id',
					schema: { type: 'panel', name: 'other' },
					meta: { enabled: true, folder: 'other' },
				},
			] as any,
			[],
		),
	).toEqual([
		{
			id: 'chart-id',
			bundle: 'bundle-id',
			schema: { type: 'panel', name: 'chart' },
			meta: { enabled: true, folder: 'chart' },
		},
	]);
});

test('adds the app entries the chunk declares to a code bundle', () => {
	expect(
		listBundleChildren(
			{
				id: 'bundle-id',
				bundle: null,
				schema: { type: 'bundle', entriesFrom: 'code', entries: [] },
				meta: { enabled: true, source: 'module', folder: 'orders' },
			} as any,
			[
				{
					id: 'notify-id',
					bundle: 'bundle-id',
					schema: { type: 'operation', name: 'notify' },
					meta: { enabled: true, folder: 'notify' },
				},
				{
					id: 'picker-id',
					bundle: 'bundle-id',
					schema: null,
					meta: { enabled: false, folder: 'picker' },
				},
				{
					id: 'removed-id',
					bundle: 'bundle-id',
					schema: null,
					meta: { enabled: false, folder: 'removed' },
				},
			] as any,
			[
				{ source: 'registry', folder: 'orders', entries: [] },
				{
					source: 'module',
					folder: 'orders',
					entries: [
						{ type: 'operation', name: 'notify' },
						{ type: 'interface', name: 'picker' },
						{ type: 'panel', name: 'chart' },
					],
				},
			],
		),
	).toEqual([
		{
			id: 'notify-id',
			bundle: 'bundle-id',
			schema: { type: 'operation', name: 'notify' },
			meta: { enabled: true, folder: 'notify' },
		},
		{
			id: 'picker-id',
			bundle: 'bundle-id',
			schema: { type: 'interface', name: 'picker' },
			meta: { enabled: false, folder: 'picker' },
		},
		{
			id: 'bundle-id/chart',
			bundle: 'bundle-id',
			schema: { type: 'panel', name: 'chart' },
			meta: {
				id: 'bundle-id/chart',
				enabled: true,
				source: 'module',
				bundle: 'bundle-id',
				folder: 'chart',
			},
		},
	]);
});
