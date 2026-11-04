import { describe, expect, test } from 'vitest';
import { readBundleEntries } from './read-bundle-entries.js';

describe('readBundleEntries', () => {
	test('reads the scalabus format', () => {
		const hookConfig = () => {};

		expect(
			readBundleEntries({
				format: 'scalabus/1',
				entries: [{ type: 'hook', name: 'audit', config: hookConfig }],
			}),
		).toEqual([{ type: 'hook', name: 'audit', config: hookConfig }]);
	});

	test('reads the hooks, endpoints and operations a manifest build exports', () => {
		const hookConfig = () => {};

		const endpointConfig = () => {};

		const operationConfig = { id: 'notify', handler: () => null };

		expect(
			readBundleEntries({
				hooks: [{ name: 'audit', config: hookConfig }],
				endpoints: [{ name: 'orders', config: endpointConfig }],
				operations: [{ name: 'notify', config: operationConfig }],
			}),
		).toEqual([
			{ type: 'hook', name: 'audit', config: hookConfig },
			{ type: 'endpoint', name: 'orders', config: endpointConfig },
			{ type: 'operation', name: 'notify', config: operationConfig },
		]);
	});

	test('refuses an unknown format', () => {
		expect(() => readBundleEntries({ format: 'scalabus/2', entries: [] })).toThrow(
			new Error(
				'Bundle module declares an unknown format "scalabus/2"; '
					+ 'expected "scalabus/1"',
			),
		);
	});

	test('refuses a module exporting neither shape', () => {
		expect(() => readBundleEntries({ hooks: [] })).toThrow(
			new Error(
				'Bundle module exports neither "scalabus/1" entries nor "hooks", '
					+ '"endpoints" and "operations"',
			),
		);
	});

	test('refuses a module exporting no object', () => {
		expect(() => readBundleEntries(undefined)).toThrow(
			new Error('Bundle module exports "undefined" instead of its entries'),
		);
	});

	test('refuses an entry of an unknown type', () => {
		expect(() => {
			return readBundleEntries({
				format: 'scalabus/1',
				entries: [{ type: 'hok', name: 'audit', config: () => {} }],
			});
		}).toThrow(
			new Error(
				'Bundle entry 0 declares an unknown type "hok"; expected "hook",'
					+ ' "endpoint", "operation" or "migration"',
			),
		);
	});

	test('refuses a migration entry without a date', () => {
		expect(() => {
			return readBundleEntries({
				format: 'scalabus/1',
				entries: [
					{
						type: 'migration',
						name: 'add-orders',
						config: { up: async () => {}, down: async () => {} },
					},
				],
			});
		}).toThrow(
			new Error(
				'Migration entry "add-orders" must be named "<date><letter>-<slug>",'
					+ ' like "20260212A-add-orders"',
			),
		);
	});

	test('refuses two entries of one name', () => {
		expect(() => {
			return readBundleEntries({
				format: 'scalabus/1',
				entries: [
					{ type: 'hook', name: 'audit', config: () => {} },
					{ type: 'endpoint', name: 'audit', config: () => {} },
				],
			});
		}).toThrow(new Error('Bundle entries repeat the name "audit"'));
	});

	test('refuses the scalabus format without an entries list', () => {
		expect(() => readBundleEntries({ format: 'scalabus/1' })).toThrow(
			new Error('Bundle module declares "scalabus/1" without an "entries" array'),
		);
	});
});
