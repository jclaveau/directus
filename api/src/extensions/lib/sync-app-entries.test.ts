import { InvalidPayloadError } from '@directus/errors';
import { describe, expect, test, vi } from 'vitest';
import { diffAppEntries, readReportedBundleEntries } from './sync-app-entries.js';

vi.mock('node:crypto', () => ({ randomUUID: () => 'new-row' }));

describe('readReportedBundleEntries', () => {
	test('takes a list of bundles with their entries', () => {
		const payload = [
			{
				source: 'module',
				folder: '@consumer/domain',
				entries: [{ type: 'interface', name: 'orders-picker' }],
			},
		];

		expect(readReportedBundleEntries(payload)).toEqual(payload);
	});

	test('refuses a payload that is not a list', () => {
		expect(() => readReportedBundleEntries({})).toThrow(
			new InvalidPayloadError({ reason: '"entries" must be an array' }),
		);
	});

	test('refuses an entry without a name, naming its bundle index', () => {
		expect(() => {
			return readReportedBundleEntries([
				{ source: 'module', folder: 'a', entries: [] },
				{ source: 'module', folder: 'b', entries: [{ type: 'panel' }] },
			]);
		}).toThrow(
			new InvalidPayloadError({
				reason: '"entries[1]" must be {source, folder, entries: [{type, name}]}',
			}),
		);
	});
});

describe('diffAppEntries', () => {
	test('adds a row for a new app entry, keeping the api entries', () => {
		expect(
			diffAppEntries(
				{
					type: 'bundle',
					entries: [{ type: 'hook', name: 'audit-orders' }],
				} as never,
				{
					id: 'bundle-row',
					enabled: true,
					source: 'module',
					bundle: null,
					folder: 'b',
				},
				[],
				[{ type: 'panel', name: 'orders-chart' }],
			),
		).toEqual({
			createdSettings: [
				{
					id: 'new-row',
					enabled: true,
					source: 'module',
					bundle: 'bundle-row',
					folder: 'orders-chart',
					type: 'panel',
				},
			],
			removedSettingIds: [],
			bundleEntries: [
				{ type: 'hook', name: 'audit-orders' },
				{ type: 'panel', name: 'orders-chart' },
			],
		});
	});

	test('removes the row of an app entry the chunk no longer declares', () => {
		expect(
			diffAppEntries(
				{
					type: 'bundle',
					entries: [{ type: 'panel', name: 'orders-chart' }],
				} as never,
				{
					id: 'bundle-row',
					enabled: true,
					source: 'module',
					bundle: null,
					folder: 'b',
				},
				[
					{
						id: 'panel-row',
						enabled: true,
						source: 'module',
						bundle: 'bundle-row',
						folder: 'orders-chart',
						type: 'panel',
					},
					{
						id: 'hook-row',
						enabled: true,
						source: 'module',
						bundle: 'bundle-row',
						folder: 'audit-orders',
						type: 'hook',
					},
				],
				[],
			),
		).toEqual({
			createdSettings: [],
			removedSettingIds: ['panel-row'],
			bundleEntries: [],
		});
	});

	test('leaves an operation entry to the api side', () => {
		expect(
			diffAppEntries(
				{
					type: 'bundle',
					entries: [{ type: 'operation', name: 'notify' }],
				} as never,
				{
					id: 'bundle-row',
					enabled: true,
					source: 'module',
					bundle: null,
					folder: 'b',
				},
				[],
				[{ type: 'operation', name: 'notify' }],
			),
		).toEqual({
			createdSettings: [],
			removedSettingIds: [],
			bundleEntries: [{ type: 'operation', name: 'notify' }],
		});
	});
});
