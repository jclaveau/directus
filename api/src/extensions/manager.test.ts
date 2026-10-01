import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The manager reaches half the api to register an extension, so everything below
// the import seam is stubbed. What is pinned here is one decision: which loads
// bypass the ESM module cache, and which do not.

const SANDBOX_FOLDER = 'test-sandboxed-hook';
const SANDBOX_EVENT = 'test-sandbox.event';

const mocks = vi.hoisted(() => {
	const noop = () => undefined;

	// manager.ts reads env once at module scope, so the sandbox limits have to be in
	// place before the import — hence the shared object every reset copies from.
	const defaultEnv = {
		SERVE_APP: false,
		EXTENSIONS_SANDBOX_MEMORY: 128,
		EXTENSIONS_SANDBOX_TIMEOUT: 10000,
	};

	return {
		defaultEnv,
		env: defaultEnv as Record<string, unknown>,
		logger: { info: noop, warn: vi.fn(), error: vi.fn(), debug: noop, trace: noop },
		bus: { subscribe: noop, publish: noop, unsubscribe: noop },
		flows: { addOperation: noop, removeOperation: noop },
		installation: { install: noop, uninstall: noop },
		importFileUrl: vi.fn(async () => ({ default: mocks.moduleDefault })),
		moduleDefault: (() => undefined) as unknown,
		extensions: {
			local: new Map(),
			registry: new Map(),
			module: new Map(),
		} as Record<string, Map<string, unknown>>,
		settings: [] as unknown[],
		sandboxedCode: '',
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));
vi.mock('../logger/index.js', () => ({ useLogger: () => mocks.logger }));
vi.mock('../bus/index.js', () => ({ useBus: () => mocks.bus }));
vi.mock('../database/index.js', () => ({ default: () => ({}) }));
vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('../services/index.js', () => ({}));
vi.mock('../flows.js', () => ({ getFlowManager: () => mocks.flows }));
vi.mock('./lib/sync-extensions.js', () => ({ syncExtensions: vi.fn() }));

vi.mock('../utils/import-file-url.js', () => {
	return { importFileUrl: mocks.importFileUrl };
});

vi.mock('./lib/get-extensions.js', () => {
	return { getExtensions: async () => mocks.extensions };
});

vi.mock('./lib/get-extensions-settings.js', () => {
	return { getExtensionsSettings: async () => mocks.settings };
});

vi.mock('./lib/installation/index.js', () => {
	return { getInstallationManager: () => mocks.installation };
});

// The internal operations are read off disk and imported by a computed specifier,
// which the test runner cannot resolve. None of them is under test here.
vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>();

	return {
		...original,
		readdir: async () => [],
		// The sandbox reads its entrypoint off disk instead of importing it.
		readFile: async (...args: Parameters<typeof original.readFile>) => {
			const isSandboxEntrypoint = String(args[0]).includes(SANDBOX_FOLDER);

			if (mocks.sandboxedCode && isSandboxEntrypoint) {
				return mocks.sandboxedCode;
			}

			return original.readFile(...args);
		},
	};
});

const { ExtensionManager } = await import('./manager.js');
const { default: emitter } = await import('../emitter.js');

beforeEach(() => {
	mocks.env = { ...mocks.defaultEnv };
});

afterEach(() => {
	vi.clearAllMocks();
});

/** One of each api extension shape, so all four import sites are covered. */
const shapes = [
	{
		type: 'hook',
		entrypoint: 'index.js',
		moduleDefault: () => undefined,
	},
	{
		type: 'endpoint',
		entrypoint: 'index.js',
		moduleDefault: () => undefined,
	},
	{
		// an operation is hybrid: its entrypoint is split, and only the api half loads
		type: 'operation',
		entrypoint: { app: 'app.js', api: 'api.js' },
		moduleDefault: { id: 'test-op', handler: () => undefined },
	},
	{
		type: 'bundle',
		entrypoint: { app: 'app.js', api: 'api.js' },
		moduleDefault: { hooks: [], endpoints: [], operations: [] },
	},
];

beforeEach(() => {
	mocks.env = { ...mocks.defaultEnv };
});

afterEach(() => {
	vi.clearAllMocks();
});

test.each(shapes)(
	'loads a $type through the module cache once, then around it',
	async ({ type, entrypoint, moduleDefault }) => {
		mocks.moduleDefault = moduleDefault;

		const folder = `test-${type}`;

		mocks.extensions = {
			local: new Map([
				[
					folder,
					{
						type,
						name: folder,
						path: `/extensions/${folder}`,
						entrypoint,
						local: true,
					},
				],
			]),
			registry: new Map(),
			module: new Map(),
		};

		mocks.settings = [{ id: '1', source: 'local', folder, enabled: true }];

		const manager = new ExtensionManager();

		await manager.initialize({ schedule: false, watch: false });

		// Nothing is cached yet on the first load, and the query that would bypass
		// the cache also makes node's compile cache miss — so it goes straight in.
		expect(mocks.importFileUrl).toHaveBeenCalledTimes(1);

		expect(mocks.importFileUrl).toHaveBeenLastCalledWith(
			expect.stringContaining(folder),
			expect.any(String),
			{ fresh: false },
		);

		await manager.reload();

		// A reload exists to pick up a changed file, which a cached module hides.
		expect(mocks.importFileUrl).toHaveBeenCalledTimes(2);

		expect(mocks.importFileUrl).toHaveBeenLastCalledWith(
			expect.stringContaining(folder),
			expect.any(String),
			{ fresh: true },
		);
	},
);

test('runs a sandboxed extension through the on-demand loader', async () => {
	mocks.sandboxedCode = `
export default ({ filter }) => {
	filter('${SANDBOX_EVENT}', (payload) => ({ ...payload, seen: true }));
};
`;

	mocks.extensions = {
		local: new Map([
			[
				SANDBOX_FOLDER,
				{
					type: 'hook',
					name: SANDBOX_FOLDER,
					path: `/extensions/${SANDBOX_FOLDER}`,
					entrypoint: 'index.js',
					local: true,
					sandbox: { enabled: true, requestedScopes: {} },
				},
			],
		]),
		registry: new Map(),
		module: new Map(),
	};

	mocks.settings = [
		{ id: '1', source: 'local', folder: SANDBOX_FOLDER, enabled: true },
	];

	await new ExtensionManager().initialize({ schedule: false, watch: false });

	// Every caller of the sandbox path swallows a throw into a warning, so a broken
	// load would leave the extension silently absent rather than fail the test.
	expect(mocks.logger.warn).not.toHaveBeenCalled();
	expect(mocks.importFileUrl).not.toHaveBeenCalled();

	// The isolate only holds a filter if the addon loaded, compiled and evaluated it.
	const filtered = emitter.emitFilter(SANDBOX_EVENT, { value: 1 }, {}, null);

	await expect(filtered).resolves.toEqual({ value: 1, seen: true });
});
