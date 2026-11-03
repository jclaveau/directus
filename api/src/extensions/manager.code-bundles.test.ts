import { InvalidPayloadError } from '@directus/errors';
import { afterEach, expect, test, vi } from 'vitest';
import { AppChunkStaleError } from './lib/sync-app-entries.js';

// The bundles declaring their entries in code: what a load reads off their
// imported api, what it bundles for the app, and how the app's report lands.

const mocks = vi.hoisted(() => {
	return {
		env: {
			SERVE_APP: true,
			TEMP_PATH: '/tmp/directus-test',
			EXTENSIONS_SANDBOX_MEMORY: 128,
			EXTENSIONS_SANDBOX_TIMEOUT: 10000,
		} as Record<string, unknown>,
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			trace: vi.fn(),
		},
		bus: { subscribe: vi.fn(), publish: vi.fn(), unsubscribe: vi.fn() },
		flows: { addOperation: vi.fn(), removeOperation: vi.fn() },
		extensions: {
			registry: new Map(),
			module: new Map(),
		} as Record<string, Map<string, unknown>>,
		settings: [] as unknown[],
		importCodeBundles: vi.fn(),
		runMigrations: vi.fn(),
		outstandingMigrations: vi.fn(async (): Promise<string[]> => []),
		pathExists: vi.fn<(target: string) => Promise<boolean>>(async () => {
			return true;
		}),
		writeFile: vi.fn(),
		generateEntrypoint: vi.fn(() => 'entry-code'),
		deleteMany: vi.fn(),
		createMany: vi.fn(),
		rollup: vi.fn(async () => {
			return {
				write: async () => {
					return {
						output: [
							{
								type: 'chunk',
								fileName: 'index.js',
								code: 'entry __DIRECTUS_APP_CHUNK_HASH__',
								isEntry: true,
							},
							{ type: 'asset' },
							{
								type: 'chunk',
								fileName: 'a-chunk.js',
								code: 'chunk',
								isEntry: false,
							},
						],
					};
				},
				close: async () => undefined,
			};
		}),
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));
vi.mock('../logger/index.js', () => ({ useLogger: () => mocks.logger }));
vi.mock('../bus/index.js', () => ({ useBus: () => mocks.bus }));
vi.mock('../flows.js', () => ({ getFlowManager: () => mocks.flows }));
vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('./lib/sync-extensions.js', () => ({ syncExtensions: vi.fn() }));
vi.mock('rollup', () => ({ rollup: mocks.rollup }));

vi.mock('../database/index.js', () => {
	return {
		default: () => ({}),
		outstandingMigrations: mocks.outstandingMigrations,
	};
});

vi.mock('../database/migrations/run.js', () => {
	return { default: mocks.runMigrations };
});

vi.mock('../services/index.js', () => {
	return {
		ItemsService: class {
			deleteMany = mocks.deleteMany;
			createMany = mocks.createMany;
		},
	};
});

vi.mock('./lib/get-extensions.js', () => {
	return { getExtensions: async () => mocks.extensions };
});

vi.mock('./lib/get-extensions-settings.js', () => {
	return { getExtensionsSettings: async () => mocks.settings };
});

vi.mock('./lib/get-shared-deps-mapping.js', () => {
	return { getSharedDepsMapping: async () => ({}) };
});

vi.mock('./lib/installation/index.js', () => {
	return { getInstallationManager: () => ({}) };
});

vi.mock('./lib/import-code-bundles.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('./lib/import-code-bundles.js')>()),
		importCodeBundles: mocks.importCodeBundles,
	};
});

vi.mock('@directus/extensions/node', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('@directus/extensions/node')>()),
		generateExtensionsEntrypoint: mocks.generateEntrypoint,
	};
});

vi.mock('fs-extra', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('fs-extra')>()),
		pathExists: mocks.pathExists,
	};
});

// The internal operations are read off disk and imported by a computed
// specifier, which the test runner cannot resolve.
vi.mock('node:fs/promises', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('node:fs/promises')>()),
		readdir: async () => [],
		writeFile: mocks.writeFile,
	};
});

const { ExtensionManager } = await import('./manager.js');

afterEach(() => {
	vi.resetAllMocks();
	vi.restoreAllMocks();
});

test('registers the entries of a code bundle from its api', async () => {
	const hookConfig = vi.fn();
	const notifyHandler = vi.fn();
	const migrationConfig = { phase: 'before-schema' };

	mocks.extensions = {
		module: new Map([
			[
				'orders',
				{
					type: 'bundle',
					name: 'orders',
					path: '/extensions/orders',
					entrypoint: { app: 'app.js', api: 'api.js' },
					entriesFrom: 'code',
					entries: [],
				},
			],
			[
				'jobs',
				{
					type: 'bundle',
					name: 'jobs',
					path: '/extensions/jobs',
					entrypoint: { app: 'app.js', api: 'api.js' },
					entriesFrom: 'code',
					entries: [],
				},
			],
		]),
		registry: new Map(),
	};

	mocks.settings = [
		{
			id: 'orders-id',
			source: 'module',
			folder: 'orders',
			bundle: null,
			enabled: true,
		},
		{
			id: 'jobs-id',
			source: 'module',
			folder: 'jobs',
			bundle: null,
			enabled: true,
		},
		{
			id: 'audit-id',
			source: 'module',
			folder: 'audit',
			bundle: 'orders-id',
			enabled: true,
		},
		{
			id: 'notify-id',
			source: 'module',
			folder: 'notify',
			bundle: 'orders-id',
			enabled: true,
		},
	];

	mocks.importCodeBundles.mockResolvedValue({
		codeBundles: [
			{
				source: 'module',
				folder: 'orders',
				name: 'orders',
				apiPath: '/extensions/orders/api.js',
				entries: [
					{ type: 'hook', name: 'audit', config: hookConfig },
					{
						type: 'operation',
						name: 'notify',
						config: { id: 'notify', handler: notifyHandler },
					},
					{ type: 'hook', name: 'disabled-hook', config: hookConfig },
					{
						type: 'migration',
						name: '20260212A-add-orders',
						config: migrationConfig,
					},
				],
			},
		],
		failures: [{ name: 'broken', error: new Error('broken bundle') }],
	});

	mocks.pathExists.mockImplementation(async (target: string) => {
		return target === '/extensions/orders/app.js';
	});

	const manager = new ExtensionManager();

	await manager.initialize({ schedule: false, watch: false });

	expect(mocks.importCodeBundles).toHaveBeenCalledWith(
		{ module: mocks.extensions['module'], registry: mocks.extensions['registry'] },
		{ fresh: false },
	);

	expect(mocks.logger.warn).toHaveBeenCalledWith('Couldn\'t import bundle "broken"');
	expect(mocks.logger.warn).toHaveBeenCalledWith(new Error('broken bundle'));

	expect(hookConfig).toHaveBeenCalledTimes(1);
	expect(mocks.flows.addOperation).toHaveBeenCalledWith('notify', notifyHandler);

	expect(manager.getExtension('module', 'orders')).toEqual({
		type: 'bundle',
		name: 'orders',
		path: '/extensions/orders',
		entrypoint: { app: 'app.js', api: 'api.js' },
		entriesFrom: 'code',
		entries: [
			{ type: 'hook', name: 'audit' },
			{ type: 'operation', name: 'notify' },
			{ type: 'hook', name: 'disabled-hook' },
		],
	});

	expect(manager.migrationEntries()).toEqual([
		{ bundle: 'orders', name: '20260212A-add-orders', config: migrationConfig },
	]);

	expect(mocks.generateEntrypoint).toHaveBeenCalledWith(
		{
			module: new Map([['orders', mocks.extensions['module']!.get('orders')]]),
			registry: new Map(),
		},
		mocks.settings,
	);

	expect(mocks.writeFile).toHaveBeenCalledWith(
		'/tmp/directus-test/app-extensions/index.js',
		'entry e557227bf7f12218ffdbc95aad3a2496b1e5587464f3577e61c797db30a29ad8',
	);

	expect(manager.getAppChunkHash()).toBe(
		'e557227bf7f12218ffdbc95aad3a2496b1e5587464f3577e61c797db30a29ad8',
	);
});

test('runs the before-schema migrations on a migrating reload', async () => {
	const beforeConfig = { phase: 'before-schema' };
	const afterConfig = { phase: 'after-schema' };

	mocks.extensions = {
		module: new Map([
			[
				'orders',
				{
					type: 'bundle',
					name: 'orders',
					path: '/extensions/orders',
					entrypoint: { app: 'app.js', api: 'api.js' },
					entriesFrom: 'code',
					entries: [],
				},
			],
		]),
		registry: new Map(),
	};

	mocks.settings = [];

	mocks.importCodeBundles.mockResolvedValue({
		codeBundles: [
			{
				source: 'module',
				folder: 'orders',
				name: 'orders',
				apiPath: '/extensions/orders/api.js',
				entries: [
					{ type: 'migration', name: '20260212A-add-orders', config: beforeConfig },
					{ type: 'migration', name: '20260212B-fill-orders', config: afterConfig },
				],
			},
		],
		failures: [],
	});

	mocks.outstandingMigrations.mockResolvedValue([
		'20250101A-core',
		'orders:20260212B-fill-orders',
	]);

	const manager = new ExtensionManager();

	await manager.initialize({ schedule: false, watch: false });

	expect(mocks.runMigrations).not.toHaveBeenCalled();

	await manager.reload({ migrate: true });

	expect(mocks.runMigrations).toHaveBeenCalledWith({}, 'latest', true, {
		extensionMigrations: [
			{ bundle: 'orders', name: '20260212A-add-orders', config: beforeConfig },
			{ bundle: 'orders', name: '20260212B-fill-orders', config: afterConfig },
		],
		phase: 'before-schema',
	});

	expect(mocks.outstandingMigrations).toHaveBeenCalledWith([
		{ bundle: 'orders', name: '20260212B-fill-orders', config: afterConfig },
	]);

	expect(mocks.logger.warn).toHaveBeenCalledWith(
		'Migrations waiting on a schema snapshot: orders:20260212B-fill-orders;'
			+ ' run "directus database migrate:latest --snapshot <path>"',
	);
});

test('refuses app entries read from a stale app chunk', async () => {
	const manager = new ExtensionManager();

	await expect(manager.syncAppEntries('stale-hash', [])).rejects.toThrow(
		new AppChunkStaleError(),
	);
});

test('refuses app entries reported for a bundle not in code', async () => {
	mocks.extensions = {
		module: new Map([
			[
				'legacy',
				{
					type: 'bundle',
					name: 'legacy',
					path: '/extensions/legacy',
					entrypoint: { app: 'app.js', api: 'api.js' },
					entries: [],
				},
			],
		]),
		registry: new Map(),
	};

	mocks.settings = [];
	mocks.importCodeBundles.mockResolvedValue({ codeBundles: [], failures: [] });

	const manager = new ExtensionManager();

	await manager.initialize({ schedule: false, watch: false });

	await expect(
		manager.syncAppEntries(
			'e557227bf7f12218ffdbc95aad3a2496b1e5587464f3577e61c797db30a29ad8',
			[{ source: 'module', folder: 'legacy', entries: [] }],
		),
	).rejects.toThrow(
		new InvalidPayloadError({
			reason: '"legacy" from "module" is not a bundle declaring its entries in code',
		}),
	);
});

test('stores the app entries the app reports for a code bundle', async () => {
	mocks.extensions = {
		module: new Map([
			[
				'orders',
				{
					type: 'bundle',
					name: 'orders',
					path: '/extensions/orders',
					entrypoint: { app: 'app.js', api: 'api.js' },
					entriesFrom: 'code',
					entries: [],
				},
			],
		]),
		registry: new Map([
			[
				'jobs',
				{
					type: 'bundle',
					name: 'jobs',
					path: '/extensions/jobs',
					entrypoint: { app: 'app.js', api: 'api.js' },
					entriesFrom: 'code',
					entries: [],
				},
			],
		]),
	};

	mocks.settings = [
		{
			id: 'orders-id',
			source: 'module',
			folder: 'orders',
			bundle: null,
			enabled: true,
		},
		{
			id: 'old-picker-id',
			source: 'module',
			folder: 'old-picker',
			bundle: 'orders-id',
			enabled: true,
			type: 'interface',
		},
	];

	mocks.importCodeBundles.mockResolvedValue({
		codeBundles: [
			{
				source: 'module',
				folder: 'orders',
				name: 'orders',
				apiPath: '/extensions/orders/api.js',
				entries: [{ type: 'hook', name: 'audit', config: vi.fn() }],
			},
		],
		failures: [],
	});

	const manager = new ExtensionManager();

	await manager.initialize({ schedule: false, watch: false });

	await manager.syncAppEntries(
		'e557227bf7f12218ffdbc95aad3a2496b1e5587464f3577e61c797db30a29ad8',
		[
			{
				source: 'module',
				folder: 'orders',
				entries: [
					{ type: 'interface', name: 'picker' },
					{ type: 'hook', name: 'audit' },
				],
			},
			{ source: 'registry', folder: 'jobs', entries: [] },
		],
	);

	expect(mocks.deleteMany).toHaveBeenCalledWith(['old-picker-id']);

	expect(mocks.createMany).toHaveBeenCalledWith([
		{
			id: expect.any(String),
			enabled: true,
			source: 'module',
			bundle: 'orders-id',
			folder: 'picker',
			type: 'interface',
		},
	]);

	expect(manager.getExtension('module', 'orders')).toEqual({
		type: 'bundle',
		name: 'orders',
		path: '/extensions/orders',
		entrypoint: { app: 'app.js', api: 'api.js' },
		entriesFrom: 'code',
		entries: [
			{ type: 'hook', name: 'audit' },
			{ type: 'interface', name: 'picker' },
		],
	});

	// The settings kept in memory now hold the picker row and lack the old one.
	await manager.syncAppEntries(
		'e557227bf7f12218ffdbc95aad3a2496b1e5587464f3577e61c797db30a29ad8',
		[
			{
				source: 'module',
				folder: 'orders',
				entries: [{ type: 'interface', name: 'picker' }],
			},
		],
	);

	expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
	expect(mocks.createMany).toHaveBeenCalledTimes(1);
});
