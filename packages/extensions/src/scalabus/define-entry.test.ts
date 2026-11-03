import { describe, expect, test } from 'vitest';
import {
	defineBundleApi,
	defineBundleApp,
	defineEndpointEntry,
	defineHookEntry,
	defineInterfaceEntry,
	defineMigrationEntry,
	defineOperationApiEntry,
	defineOperationAppEntry,
} from './define-entry.js';

describe('define<Type>Entry', () => {
	test('wraps a config with its type and name', () => {
		const hookConfig = () => {};

		const endpointConfig = () => {};

		const handler = () => null;

		expect(defineHookEntry('audit', hookConfig)).toEqual({
			type: 'hook',
			name: 'audit',
			config: hookConfig,
		});

		expect(defineEndpointEntry('orders', endpointConfig)).toEqual({
			type: 'endpoint',
			name: 'orders',
			config: endpointConfig,
		});

		expect(defineOperationApiEntry('notify', { id: 'notify', handler })).toEqual({
			type: 'operation',
			name: 'notify',
			config: { id: 'notify', handler },
		});
	});
});

describe('defineMigrationEntry', () => {
	test('defaults the phase to before-schema', () => {
		const up = async () => {};

		const down = async () => {};

		expect(defineMigrationEntry('20260212A-add-orders', { up, down })).toEqual({
			type: 'migration',
			name: '20260212A-add-orders',
			config: { up, down, phase: 'before-schema' },
		});
	});

	test('keeps an after-schema phase and a transaction scope', () => {
		const up = async () => {};

		const down = async () => {};

		expect(
			defineMigrationEntry('20260212B-fill-orders', {
				up,
				down,
				phase: 'after-schema',
				transactionScope: 'own',
			}),
		).toEqual({
			type: 'migration',
			name: '20260212B-fill-orders',
			config: { up, down, phase: 'after-schema', transactionScope: 'own' },
		});
	});

	test('refuses a name without a date and a letter', () => {
		const up = async () => {};

		expect(() => defineMigrationEntry('add-orders', { up, down: up })).toThrow(
			new Error(
				'Migration entry "add-orders" must be named "<date><letter>-<slug>", '
					+ 'like "20260212A-add-orders"',
			),
		);
	});

	test('refuses an unknown phase', () => {
		const up = async () => {};

		expect(() => {
			return defineMigrationEntry('20260212A-add-orders', {
				up,
				down: up,
				phase: 'during-schema' as 'after-schema',
			});
		}).toThrow(
			new Error(
				'Migration entry "20260212A-add-orders" declares an unknown phase '
					+ '"during-schema";'
					+ ' expected "before-schema" or "after-schema"',
			),
		);
	});
});

describe('defineBundleApi / defineBundleApp', () => {
	test('tags the entries with the scalabus format', () => {
		const hookConfig = () => {};

		const handler = () => null;

		expect(defineBundleApi([defineHookEntry('audit', hookConfig)])).toEqual({
			format: 'scalabus/1',
			entries: [{ type: 'hook', name: 'audit', config: hookConfig }],
		});

		expect(
			defineBundleApp([
				defineOperationAppEntry('notify', {
					id: 'notify',
					name: 'Notify',
					icon: 'bolt',
					overview: handler,
					options: [],
				}),
			]),
		).toEqual({
			format: 'scalabus/1',
			entries: [
				{
					type: 'operation',
					name: 'notify',
					config: {
						id: 'notify',
						name: 'Notify',
						icon: 'bolt',
						overview: handler,
						options: [],
					},
				},
			],
		});
	});

	test('refuses two api entries with the same name', () => {
		const hookConfig = () => {};

		expect(() => {
			return defineBundleApi([
				defineHookEntry('audit', hookConfig),
				defineEndpointEntry('audit', hookConfig),
			]);
		}).toThrow(new Error('Bundle entries repeat the name "audit"'));
	});

	test('refuses two app entries with the same name', () => {
		const component = {};

		expect(() => {
			return defineBundleApp([
				defineInterfaceEntry('picker', {
					id: 'picker',
					name: 'Picker',
					icon: 'box',
					component,
					options: null,
					types: ['string'],
				}),
				defineInterfaceEntry('picker', {
					id: 'picker-2',
					name: 'Picker 2',
					icon: 'box',
					component,
					options: null,
					types: ['string'],
				}),
			]);
		}).toThrow(new Error('Bundle entries repeat the name "picker"'));
	});
});
