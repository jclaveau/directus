import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import { APP_SHARED_DEPS } from '@directus/extensions';
import { HYBRID_EXTENSION_TYPES } from '@directus/constants';
import { generateExtensionsEntrypoint } from '@directus/extensions/node';
import type {
	ActionHandler,
	EmbedHandler,
	FilterHandler,
	InitHandler,
	PromiseCallback,
	ScheduleHandler,
	ApiExtension,
	BundleExtension,
	EndpointConfig,
	Extension,
	ExtensionSettings,
	HookConfig,
	HybridExtension,
	OperationApiConfig,
	ExtensionManagerOptions,
} from '@directus/types';
import { isTypeIn, toBoolean } from '@directus/utils';
import { processId } from '@directus/utils/node';
import alias from '@rollup/plugin-alias';
import nodeResolve from '@rollup/plugin-node-resolve';
import virtual from '@rollup/plugin-virtual';
import chokidar, { FSWatcher } from 'chokidar';
import express, { Router } from 'express';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { pathExists } from 'fs-extra';
import os from 'node:os';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReadStream } from 'node:fs';
import { rolldown } from 'rolldown';
import { rollup } from 'rollup';
import { useBus } from '../bus/index.js';
import getDatabase, { outstandingMigrations } from '../database/index.js';
import runMigrations from '../database/migrations/run.js';
import type { ExtensionMigration } from '../database/migrations/list.js';
import { readBundleEntries } from '@directus/extensions/scalabus';
import { createHash } from 'node:crypto';
import emitter, { Emitter } from '../emitter.js';
import { getFlowManager } from '../flows.js';
import { useLogger } from '../logger/index.js';
import * as services from '../services/index.js';
import { deleteFromRequireCache } from '../utils/delete-from-require-cache.js';
import { trackSandboxCoverage } from '../utils/dump-coverage.js';
import getModuleDefault from '../utils/get-module-default.js';
import { getSchema } from '../utils/get-schema.js';
import { importFileUrl } from '../utils/import-file-url.js';
import { JobQueue } from '../utils/job-queue.js';
import { loadIsolatedVm } from '../utils/load-isolated-vm.js';
import { clone, debounce, isPlainObject } from '../utils/lodash-es-used.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';
import { getRegistryRootPath } from './lib/get-registry-root-path.js';
import { getExtensionsSettings } from './lib/get-extensions-settings.js';
import {
	AppChunkStaleError,
	diffAppEntries,
	type ReportedBundleEntries,
} from './lib/sync-app-entries.js';
import {
	importCodeBundles,
	listMigrationEntries,
	type CodeBundle,
} from './lib/import-code-bundles.js';
import { getExtensions } from './lib/get-extensions.js';
import { getSharedDepsMapping } from './lib/get-shared-deps-mapping.js';
import { getInstallationManager } from './lib/installation/index.js';
import type { InstallationManager } from './lib/installation/manager.js';
import { generateApiExtensionsSandboxEntrypoint } from './lib/sandbox/generate-api-extensions-sandbox-entrypoint.js';
import { instantiateSandboxSdk } from './lib/sandbox/sdk/instantiate.js';
import { createScopedCacheExtensionHandle } from './lib/scoped-cache-handle.js';
import { syncExtensions } from './lib/sync-extensions.js';
import { wrapEmbeds } from './lib/wrap-embeds.js';
import DriverLocal from '@directus/storage-driver-local';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = useEnv();

type ReloadOptions = { forceSync?: boolean; migrate?: boolean };

const defaultOptions: ExtensionManagerOptions = {
	schedule: true,
	watch: env['EXTENSIONS_AUTO_RELOAD'] as boolean,
};

export class ExtensionManager {
	private options: ExtensionManagerOptions = defaultOptions;

	/**
	 * Whether or not the extensions have been read from disk and registered into the system
	 */
	private isLoaded = false;

	/**
	 * Whether a load has already happened in this process. A reload has to bypass
	 * the ESM module cache to pick a changed file up, but the very first load has
	 * nothing to bypass — and the cache-busting query it would use also makes
	 * Node's own compile cache miss every time.
	 */
	private hasLoadedBefore = false;

	/**
	 * The extensions the last successful load registered, which a failed reload
	 * leaves in place for the retry to compare against.
	 */
	private lastLoadedExtensions: Extension[] = [];

	// folder:Extension

	// versionId:Extension
	private registryExtensions: Map<string, Extension> = new Map();

	// name:Extension
	private moduleExtensions: Map<string, Extension> = new Map();

	/**
	 * Settings for the extensions that are loaded within the current process
	 */
	private extensionsSettings: ExtensionSettings[] = [];

	/**
	 * Individual filename chunks from the rollup bundle. Used to improve the performance by allowing
	 * extensions to split up their bundle into multiple smaller chunks
	 */
	private appExtensionChunks: string[] = [];

	/**
	 * The hash of the app chunks the last bundling wrote, which the app compares
	 * against the one it runs to tell it was rebuilt.
	 */
	private appChunkHash: string | null = null;

	/**
	 * The bundles declaring their entries in code, with their imported api
	 * entries.
	 */
	private codeBundles: CodeBundle[] = [];

	/**
	 * Callbacks to be able to unregister extensions
	 */
	private unregisterFunctionMap: Map<string, PromiseCallback> = new Map();

	/**
	 * A local-to-extensions scoped emitter that can be used to fire and listen to custom events
	 * between extensions. These events are completely isolated from the core events that trigger
	 * hooks etc
	 */
	private localEmitter: Emitter = new Emitter();

	/**
	 * Locally scoped express router used for custom endpoints. Allows extensions to dynamically
	 * register and de-register endpoints without affecting the regular global router
	 */
	private endpointRouter: Router = Router();

	/**
	 * Custom HTML to be injected at the end of the `<head>` tag of the app's index.html
	 */
	private hookEmbedsHead: string[] = [];

	/**
	 * Custom HTML to be injected at the end of the `<body>` tag of the app's index.html
	 */
	private hookEmbedsBody: string[] = [];

	/**
	 * Used to prevent race conditions when reloading extensions. Forces each reload to happen in
	 * sequence.
	 */
	private reloadQueue: JobQueue = new JobQueue();

	/** The reload waiting behind the running one, which later callers share. */
	private queuedReload: Promise<unknown> | null = null;

	/** What the queued reload loads with, forced if any caller sharing it asked. */
	private queuedReloadOptions: ReloadOptions | undefined = undefined;

	/**
	 * Optional file system watcher to auto-reload extensions when the local file system changes
	 */
	private watcher: FSWatcher | null = null;

	/**
	 * installation manager responsible for installing extensions from registries
	 */

	private installationManager: InstallationManager = getInstallationManager();

	private messenger = useBus();

	/**
	 * channel to publish on registering extension from external registry
	 */
	private reloadChannel = `extensions.reload`;

	private processId = processId();

	public get extensions() {
		return [...this.registryExtensions.values(), ...this.moduleExtensions.values()];
	}

	/**
	 * The `defineMigrationEntry`s of the installed bundles, as the last load
	 * read them.
	 */
	public migrationEntries(): ExtensionMigration[] {
		return listMigrationEntries(this.codeBundles);
	}

	public getAppChunkHash(): string | null {
		return this.appChunkHash;
	}

	/**
	 * Stores the app entries the app read from the chunk it runs, for the bundles
	 * declaring their entries in code: the server never runs their `app.js`.
	 */
	public async syncAppEntries(
		chunk: string,
		reported: ReportedBundleEntries[],
	): Promise<void> {
		if (chunk !== this.appChunkHash) {
			throw new AppChunkStaleError();
		}

		const itemsService = new services.ItemsService<ExtensionSettings>(
			'directus_extensions',
			{
				knex: getDatabase(),
				schema: await getSchema(),
			},
		);

		for (const { source, folder, entries } of reported) {
			const bundle = this.getExtension(source, folder);

			if (bundle?.type !== 'bundle' || bundle.entriesFrom !== 'code') {
				throw new InvalidPayloadError({
					reason: `${JSON.stringify(folder)} from ${JSON.stringify(source)}`
						+ ` is not a bundle declaring its entries in code`,
				});
			}

			const bundleSettings = this.extensionsSettings.find(
				(row) => {
					return row.source === source
						&& row.folder === folder
						&& row.bundle === null;
				},
			);

			if (!bundleSettings) {
				continue;
			}

			const changes = diffAppEntries(
				bundle,
				bundleSettings,
				this.extensionsSettings,
				entries,
			);

			if (changes.removedSettingIds.length > 0) {
				await itemsService.deleteMany(changes.removedSettingIds);
			}

			if (changes.createdSettings.length > 0) {
				await itemsService.createMany(changes.createdSettings);
			}

			bundle.entries = changes.bundleEntries;

			this.extensionsSettings = [
				...this.extensionsSettings.filter(
					(row) => !changes.removedSettingIds.includes(row.id),
				),
				...changes.createdSettings,
			];
		}
	}

	public getExtension(source: string, folder: string) {
		switch (source) {
			case 'module':
				return this.moduleExtensions.get(folder);
			case 'registry':
				return this.registryExtensions.get(folder);
		}

		return undefined;
	}

	/**
	 * Load and register all extensions
	 *
	 * @param {ExtensionManagerOptions} options - Extension manager configuration options
	 * @param {boolean} options.schedule - Whether or not to allow for scheduled (CRON) hook extensions
	 * @param {boolean} options.watch - Whether or not to watch the local extensions folder for changes
	 */
	public async initialize(options: Partial<ExtensionManagerOptions> = {}): Promise<void> {
		const logger = useLogger();

		this.options = {
			...defaultOptions,
			...options,
		};

		const wasWatcherInitialized = this.watcher !== null;

		if (this.options.watch && !wasWatcherInitialized) {
			this.initializeWatcher();
		} else if (!this.options.watch && wasWatcherInitialized) {
			await this.closeWatcher();
		}

		if (!this.isLoaded) {
			await this.load();

			if (this.extensions.length > 0) {
				logger.info(`Loaded extensions: ${this.extensions.map((ext) => ext.name).join(', ')}`);
			}
		}

		if (this.options.watch && !wasWatcherInitialized) {
			this.updateWatchedExtensions([...this.extensions]);
		}

		this.messenger.subscribe(this.reloadChannel, (payload: Record<string, unknown>) => {
			// Ignore requests for reloading that were published by the current process
			if (isPlainObject(payload) && 'origin' in payload && payload['origin'] === this.processId) return;
			this.reloadLoggingFailure('a request from another process');
		});
	}

	/**
	 * Installs an external extension from registry
	 */
	public async install(versionId: string): Promise<void> {
		const logger = useLogger();

		await this.installationManager.install(versionId);
		await this.reload({ forceSync: true });

		emitter.emitAction('extensions.installed', {
			extensions: this.extensions,
			versionId,
		});

		logger.info(`Installed extension: ${versionId}`);

		await this.broadcastReloadNotification();
	}

	public async uninstall(folder: string) {
		const logger = useLogger();

		await this.installationManager.uninstall(folder);
		await this.reload({ forceSync: true });

		emitter.emitAction('extensions.uninstalled', {
			extensions: this.extensions,
			folder,
		});

		logger.info(`Uninstalled extension: ${folder}`);

		await this.broadcastReloadNotification();
	}

	public async broadcastReloadNotification() {
		await this.messenger.publish(this.reloadChannel, { origin: this.processId });
	}

	/**
	 * Load all extensions from disk and register them in their respective places
	 */
	private async load(options?: ReloadOptions): Promise<void> {
		const logger = useLogger();

		if (env['EXTENSIONS_LOCATION']) {
			try {
				await syncExtensions({ force: options?.forceSync ?? false });
			} catch (error) {
				logger.error(`Failed to sync extensions`);
				logger.error(error);
				process.exit(1);
			}
		}

		try {
			const { registry, module } = await getExtensions();

			this.registryExtensions = registry;
			this.moduleExtensions = module;

			await this.importCodeBundles();

			this.extensionsSettings = await getExtensionsSettings({ registry, module });
		} catch (error) {
			this.handleExtensionError({ error, reason: `Couldn't load extensions` });
		}

		// Outside the guard above: a failing migration fails the reload, whatever
		// EXTENSIONS_MUST_LOAD says, rather than registering over a stale schema.
		if (options?.migrate) {
			await this.migrateBeforeSchema();
		}

		await Promise.all([this.registerInternalOperations(), this.registerApiExtensions()]);

		this.hasLoadedBefore = true;

		if (env['SERVE_APP']) {
			await this.generateExtensionBundle();
		}

		this.isLoaded = true;
		this.lastLoadedExtensions = clone(this.extensions);

		emitter.emitAction('extensions.load', {
			extensions: this.extensions,
		});

		logger.info('Extensions loaded');
	}

	/**
	 * Imports the api side of the bundles declaring their entries in code, and
	 * lists their api entries — migrations aside, which get no settings row —
	 * so the settings sync sees them.
	 */
	private async importCodeBundles(): Promise<void> {
		const { codeBundles, failures } = await importCodeBundles(
			{ module: this.moduleExtensions, registry: this.registryExtensions },
			{ fresh: this.hasLoadedBefore },
		);

		this.codeBundles = codeBundles;

		for (const { name, error } of failures) {
			this.handleExtensionError({
				error,
				reason: `Couldn't import bundle "${name}"`,
			});
		}

		for (const codeBundle of codeBundles) {
			const extension = this.getExtension(codeBundle.source, codeBundle.folder);

			if (extension?.type !== 'bundle') {
				continue;
			}

			extension.entries = codeBundle.entries.flatMap((entry) => {
				return entry.type === 'migration'
					? []
					: [{ type: entry.type, name: entry.name }];
			});
		}
	}

	/**
	 * Runs the before-schema migrations a changed bundle brings, for
	 * `EXTENSIONS_AUTO_MIGRATE`. The after-schema ones wait on a snapshot, which
	 * only `migrate:latest --snapshot` applies, so they are only named.
	 */
	private async migrateBeforeSchema(): Promise<void> {
		const logger = useLogger();
		const extensionMigrations = this.migrationEntries();

		await runMigrations(getDatabase(), 'latest', true, {
			extensionMigrations,
			phase: 'before-schema',
		});

		const afterSchemaVersions = await outstandingMigrations(
			extensionMigrations.filter(({ config }) => config.phase === 'after-schema'),
		);

		const pendingAfterSchema = afterSchemaVersions.filter(
			(version) => version.includes(':'),
		);

		if (pendingAfterSchema.length > 0) {
			logger.warn(
				`Migrations waiting on a schema snapshot: ${pendingAfterSchema.join(', ')};`
					+ ' run "directus database migrate:latest --snapshot <path>"',
			);
		}
	}

	/**
	 * Unregister all extensions from the current process
	 */
	private async unload(): Promise<void> {
		await this.unregisterApiExtensions();

		this.localEmitter.offAll();

		this.isLoaded = false;

		emitter.emitAction('extensions.unload', {
			extensions: this.extensions,
		});

		const logger = useLogger();

		logger.info('Extensions unloaded');
	}

	/**
	 * Reload all the extensions. Will unload if extensions have already been loaded
	 */
	public reload(options?: ReloadOptions): Promise<unknown> {
		if (this.queuedReload !== null) {
			// The queued job will already handle the additional changes
			this.queuedReloadOptions = {
				forceSync: Boolean(
					this.queuedReloadOptions?.forceSync || options?.forceSync,
				),
				migrate: Boolean(this.queuedReloadOptions?.migrate || options?.migrate),
			};

			return this.queuedReload;
		}

		const logger = useLogger();

		let resolve: (val?: unknown) => void;
		let reject: (val?: unknown) => void;

		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});

		const reloadExtensions = async (reloadOptions?: ReloadOptions) => {
			// A failed load leaves isLoaded false; keeping the last loaded set
			// instead of retrying it is tracked in #627.
			if (this.hasLoadedBefore) {
				const prevExtensions = this.lastLoadedExtensions;

				await this.unload();
				await this.load(reloadOptions);

				logger.info('Extensions reloaded');

				const added = this.extensions.filter(
					(extension) => !prevExtensions.some((prevExtension) => extension.path === prevExtension.path),
				);

				const removed = prevExtensions.filter(
					(prevExtension) => !this.extensions.some((extension) => prevExtension.path === extension.path),
				);

				this.updateWatchedExtensions(added, removed);

				const addedExtensions = added.map((extension) => extension.name);
				const removedExtensions = removed.map((extension) => extension.name);

				emitter.emitAction('extensions.reload', {
					extensions: this.extensions,
					added: addedExtensions,
					removed: removedExtensions,
				});

				if (addedExtensions.length > 0) {
					logger.info(`Added extensions: ${addedExtensions.join(', ')}`);
				}

				if (removedExtensions.length > 0) {
					logger.info(`Removed extensions: ${removedExtensions.join(', ')}`);
				}

				resolve();
			} else {
				logger.warn('Extensions have to be loaded before they can be reloaded');
				reject(new Error('Extensions have to be loaded before they can be reloaded'));
			}
		};

		this.queuedReload = promise;
		this.queuedReloadOptions = options;

		this.reloadQueue.enqueue(async () => {
			const reloadOptions = this.queuedReloadOptions;

			this.queuedReload = null;
			this.queuedReloadOptions = undefined;

			try {
				await reloadExtensions(reloadOptions);
			}
			catch (error) {
				reject(error);
			}
		});

		return promise;
	}

	/**
	 * Return the previously generated app extension bundle chunk by name.
	 * Providing no name will return the entry bundle.
	 */
	public async getAppExtensionChunk(name?: string): Promise<ReadStream | null> {
		let file: string | undefined;

		if (!name) {
			file = this.appExtensionChunks[0];
		} else if (this.appExtensionChunks.includes(name)) {
			file = name;
		}

		if (!file) return null;

		const tempDir = join(env['TEMP_PATH'] as string, 'app-extensions');
		const tmpStorage = new DriverLocal({ root: tempDir });

		if ((await tmpStorage.exists(file)) === false) return null;

		return await tmpStorage.read(file);
	}

	/**
	 * Return the scoped router for custom endpoints
	 */
	public getEndpointRouter(): Router {
		return this.endpointRouter;
	}

	/**
	 * Return the custom HTML head and body embeds wrapped in a marker comment
	 */
	public getEmbeds() {
		return {
			head: wrapEmbeds('Custom Embed Head', this.hookEmbedsHead),
			body: wrapEmbeds('Custom Embed Body', this.hookEmbedsBody),
		};
	}

	/** For the callers nothing awaits, whose rejection would be unhandled. */
	private reloadLoggingFailure(trigger: string): void {
		this.reload().catch((error) => {
			useLogger().error(error, `Failed to reload the extensions on ${trigger}`);
		});
	}

	/**
	 * Start the chokidar watcher for extensions on the local filesystem
	 */
	private initializeWatcher(): void {
		const logger = useLogger();

		logger.info('Watching extensions for changes...');

		const changeTrigger = 'a change in the extension packages';

		// A reload another process asks for never migrates: the process that saw
		// the change already has.
		const reloadOnChange = () => {
			this.reload({
				migrate: env['EXTENSIONS_AUTO_MIGRATE'] === true,
			}).catch((error) => {
				useLogger().error(
					error,
					`Failed to reload the extensions on ${changeTrigger}`,
				);
			});
		};

		this.watcher = chokidar.watch(
			[path.resolve('package.json')],
			{
				ignoreInitial: true,
				// on macOS dotdirs in linked extensions are watched too
				followSymlinks: os.platform() === 'darwin' ? false : true,
			},
		);

		this.watcher
			.on(
				'add',
				debounce(reloadOnChange, 500),
			)
			.on(
				'change',
				debounce(reloadOnChange, 650),
			)
			.on(
				'unlink',
				debounce(reloadOnChange, 2000),
			);
	}

	/**
	 * Close and destroy the local filesystem watcher if enabled
	 */
	private async closeWatcher(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close();

			this.watcher = null;
		}
	}

	/**
	 * Update the chokidar watcher configuration when new extensions are added or existing ones
	 * removed
	 */
	private updateWatchedExtensions(added: Extension[], removed: Extension[] = []): void {
		if (!this.watcher) return;

		const registryDir = path.join(
			path.resolve(getRegistryRootPath()),
			'.registry',
		);

		const toPackageExtensionPaths = (extensions: Extension[]) =>
			extensions
				.filter((extension) => extension.local && !extension.path.startsWith(registryDir))
				.flatMap((extension) =>
					isTypeIn(extension, HYBRID_EXTENSION_TYPES) || extension.type === 'bundle'
						? [
								path.resolve(extension.path, extension.entrypoint.app),
								path.resolve(extension.path, extension.entrypoint.api),
							]
						: path.resolve(extension.path, extension.entrypoint),
				);

		this.watcher.add(toPackageExtensionPaths(added));
		this.watcher.unwatch(toPackageExtensionPaths(removed));
	}

	/**
	 * Uses rollup to bundle the app extensions together into a single file the app can download and
	 * run.
	 */
	private async generateExtensionBundle(): Promise<void> {
		const logger = useLogger();
		const env = useEnv();

		const sharedDepsMapping = await getSharedDepsMapping(APP_SHARED_DEPS);

		const internalImports = Object.entries(sharedDepsMapping).map(([name, path]) => ({
			find: name,
			replacement: path,
		}));

		const entrypoint = generateExtensionsEntrypoint(
			{
				module: await withoutAppLessCodeBundles(this.moduleExtensions),
				registry: await withoutAppLessCodeBundles(this.registryExtensions),
			},
			this.extensionsSettings,
		) + '\nexport const chunkHash = '
			+ `${JSON.stringify(APP_CHUNK_HASH_PLACEHOLDER)};\n`;

		try {
			/** Opt In for now. Should be @deprecated later to always use rolldown! */
			const rollDirection = (env['EXTENSIONS_ROLLDOWN'] ?? false) ? rolldown : rollup;

			const bundle = await rollDirection({
				input: 'entry',
				external: Object.values(sharedDepsMapping),
				makeAbsoluteExternalsRelative: false,
				plugins: [virtual({ entry: entrypoint }), alias({ entries: internalImports }), nodeResolve({ browser: true })],
			});

			const tempDir = join(env['TEMP_PATH'] as string, 'app-extensions');

			const { output } = await bundle.generate({ format: 'es' });

			this.appExtensionChunks = output.reduce<string[]>((acc, chunk) => {
				if (chunk.type === 'chunk') acc.push(chunk.fileName);

				return acc;
			}, []);

			this.appChunkHash = await writeStampedAppChunks(tempDir, output);

			await bundle.close();
		} catch (error) {
			logger.warn(`Couldn't bundle App extensions`);
			logger.warn(error);
		}
	}

	private async registerSandboxedApiExtension(extension: ApiExtension | HybridExtension) {
		const logger = useLogger();

		const sandboxMemory = Number(env['EXTENSIONS_SANDBOX_MEMORY']);
		const sandboxTimeout = Number(env['EXTENSIONS_SANDBOX_TIMEOUT']);

		const entrypointPath = path.resolve(
			extension.path,
			isTypeIn(extension, HYBRID_EXTENSION_TYPES) ? extension.entrypoint.api : extension.entrypoint,
		);

		const extensionCode = await readFile(entrypointPath, 'utf-8');

		const ivm = await loadIsolatedVm();

		const isolate = new ivm.Isolate({
			memoryLimit: sandboxMemory,
			onCatastrophicError: (error) => {
				logger.error(`Error in API extension sandbox of ${extension.type} "${extension.name}"`);
				logger.error(error);

				process.abort();
			},
		});

		const context = await isolate.createContext();
		context.global.setSync('process', { env: { NODE_ENV: process.env['NODE_ENV'] ?? 'production' } }, { copy: true });

		const module = await isolate.compileModule(extensionCode, { filename: `file://${entrypointPath}` });

		const sdkModule = await instantiateSandboxSdk(isolate, extension.sandbox?.requestedScopes ?? {});

		await module.instantiate(context, (specifier) => {
			if (specifier !== 'directus:api') {
				throw new Error('Imports other than "directus:api" are prohibited in API extension sandboxes');
			}

			return sdkModule;
		});

		await module.evaluate({ timeout: sandboxTimeout });

		// what an instrumented build records stays on the isolate's globalThis
		const isInstrumented = await context.eval(
			'globalThis.__coverage__ !== undefined',
			{ timeout: sandboxTimeout },
		);

		const releaseSandboxCoverage = isInstrumented
			? trackSandboxCoverage(async () => {
				return JSON.parse(await context.eval(
					'JSON.stringify({ coverage: globalThis.__coverage__, '
						+ 'coverageDirs: globalThis.__extensionCoverageDirs ?? [] })',
					{ timeout: sandboxTimeout },
				));
			}, extension.name)
			: undefined;

		const cb = await module.namespace.get('default', { reference: true });

		const { code, hostFunctions, unregisterFunction } = generateApiExtensionsSandboxEntrypoint(
			extension.type,
			extension.name,
			this.endpointRouter,
		);

		await context.evalClosure(code, [cb, ...hostFunctions.map((fn) => new ivm.Reference(fn))], {
			timeout: sandboxTimeout,
			filename: '<extensions-sandbox>',
		});

		this.unregisterFunctionMap.set(extension.name, async () => {
			try {
				await unregisterFunction();
				await releaseSandboxCoverage?.();
			}
			finally {
				if (!isolate.isDisposed) {
					isolate.dispose();
				}
			}
		});
	}

	private async registerApiExtensions(): Promise<void> {
		const sources = {
			module: this.moduleExtensions,
			registry: this.registryExtensions,
		} as const;

		await Promise.all(
			Object.entries(sources).map(async ([source, extensions]) => {
				await Promise.all(
					Array.from(extensions.entries()).map(async ([folder, extension]) => {
						const { id, enabled } = this.extensionsSettings.find(
							(settings) => settings.source === source && settings.folder === folder,
						) ?? { enabled: false };

						if (!enabled) return;

						switch (extension.type) {
							case 'hook':
								await this.registerHookExtension(extension);
								break;
							case 'endpoint':
								await this.registerEndpointExtension(extension);
								break;
							case 'operation':
								await this.registerOperationExtension(extension);
								break;
							case 'bundle':
								await this.registerBundleExtension(
									extension,
									source as 'module' | 'registry',
									id,
								);

								break;
							default:
								return;
						}
					}),
				);
			}),
		);
	}

	private async registerHookExtension(hook: ApiExtension) {
		try {
			if (hook.sandbox?.enabled) {
				await this.registerSandboxedApiExtension(hook);
			} else {
				const hookPath = path.resolve(hook.path, hook.entrypoint);

				const hookInstance: HookConfig | { default: HookConfig } = await importFileUrl(hookPath, import.meta.url, {
					fresh: this.hasLoadedBefore,
				});

				const config = getModuleDefault(hookInstance);

				const unregisterFunctions = this.registerHook(config, hook.name);

				this.unregisterFunctionMap.set(hook.name, async () => {
					await Promise.all(unregisterFunctions.map((fn) => fn()));

					deleteFromRequireCache(hookPath);
				});
			}
		} catch (error) {
			this.handleExtensionError({ error, reason: `Couldn't register hook "${hook.name}"` });
		}
	}

	private async registerEndpointExtension(endpoint: ApiExtension) {
		try {
			if (endpoint.sandbox?.enabled) {
				await this.registerSandboxedApiExtension(endpoint);
			} else {
				const endpointPath = path.resolve(endpoint.path, endpoint.entrypoint);

				const endpointInstance: EndpointConfig | { default: EndpointConfig } = await importFileUrl(
					endpointPath,
					import.meta.url,
					{
						fresh: this.hasLoadedBefore,
					},
				);

				const config = getModuleDefault(endpointInstance);

				const unregister = this.registerEndpoint(config, endpoint.name);

				this.unregisterFunctionMap.set(endpoint.name, async () => {
					await unregister();

					deleteFromRequireCache(endpointPath);
				});
			}
		} catch (error) {
			this.handleExtensionError({ error, reason: `Couldn't register endpoint "${endpoint.name}"` });
		}
	}

	private async registerOperationExtension(operation: HybridExtension) {
		try {
			if (operation.sandbox?.enabled) {
				await this.registerSandboxedApiExtension(operation);
			} else {
				const operationPath = path.resolve(operation.path, operation.entrypoint.api!);

				const operationInstance: OperationApiConfig | { default: OperationApiConfig } = await importFileUrl(
					operationPath,
					import.meta.url,
					{
						fresh: this.hasLoadedBefore,
					},
				);

				const config = getModuleDefault(operationInstance);

				const unregister = this.registerOperation(config);

				this.unregisterFunctionMap.set(operation.name, async () => {
					await unregister();

					deleteFromRequireCache(operationPath);
				});
			}
		} catch (error) {
			this.handleExtensionError({ error, reason: `Couldn't register operation "${operation.name}"` });
		}
	}

	private async registerBundleExtension(
		bundle: BundleExtension,
		source: 'registry' | 'module',
		bundleId: string,
	) {
		const extensionEnabled = (extensionName: string) => {
			const settings = this.extensionsSettings.find(
				(settings) => settings.source === source && settings.folder === extensionName && settings.bundle === bundleId,
			);

			if (!settings) return false;
			return settings.enabled;
		};

		try {
			const bundlePath = path.resolve(bundle.path, bundle.entrypoint.api);

			const codeBundle = this.codeBundles.find(
				(candidate) => {
					return candidate.source === source
						&& candidate.apiPath === bundlePath;
				},
			);

			// A code bundle without an api.js has nothing to register.
			if (bundle.entriesFrom === 'code' && !codeBundle) {
				return;
			}

			const bundleEntries = codeBundle?.entries ?? readBundleEntries(
				getModuleDefault(
					await importFileUrl(bundlePath, import.meta.url, {
						fresh: this.hasLoadedBefore,
					}),
				),
			);

			const unregisterFunctions: PromiseCallback[] = [];

			for (const entry of bundleEntries) {
				if (entry.type === 'migration' || !extensionEnabled(entry.name)) {
					continue;
				}

				if (entry.type === 'hook') {
					unregisterFunctions.push(...this.registerHook(entry.config, entry.name));
				}
				else if (entry.type === 'endpoint') {
					unregisterFunctions.push(this.registerEndpoint(entry.config, entry.name));
				}
				else {
					unregisterFunctions.push(this.registerOperation(entry.config));
				}
			}

			this.unregisterFunctionMap.set(bundle.name, async () => {
				await Promise.all(unregisterFunctions.map((fn) => fn()));

				deleteFromRequireCache(bundlePath);
			});
		} catch (error) {
			this.handleExtensionError({ error, reason: `Couldn't register bundle "${bundle.name}"` });
		}
	}

	/**
	 * Import the operation module code for all operation extensions, and register them individually through
	 * registerOperation
	 */
	private async registerInternalOperations(): Promise<void> {
		const internalOperations = await readdir(path.join(__dirname, '..', 'operations'));

		for (const operation of internalOperations) {
			const operationInstance: OperationApiConfig | { default: OperationApiConfig } = await import(
				`../operations/${operation}/index.js`
			);

			const config = getModuleDefault(operationInstance);

			this.registerOperation(config);
		}
	}

	/**
	 * Register a single hook
	 */
	private registerHook(hookRegistrationCallback: HookConfig, name: string): PromiseCallback[] {
		const logger = useLogger();

		let scheduleIndex = 0;

		const unregisterFunctions: PromiseCallback[] = [];

		const hookRegistrationContext = {
			// `any` for the context: the overloads on `RegisterFilter` decide what a
			// handler sees from the event name, this one implementation serves them all.
			filter: <TIn = unknown, TOut = TIn>(
				event: string,
				handler: FilterHandler<TIn, TOut, any>,
			) => {
				emitter.onFilter(event, handler);

				unregisterFunctions.push(() => {
					emitter.offFilter(event, handler);
				});
			},
			action: (event: string, handler: ActionHandler) => {
				emitter.onAction(event, handler);

				unregisterFunctions.push(() => {
					emitter.offAction(event, handler);
				});
			},
			init: (event: string, handler: InitHandler) => {
				emitter.onInit(event, handler);

				unregisterFunctions.push(() => {
					emitter.offInit(name, handler);
				});
			},
			schedule: (cron: string, handler: ScheduleHandler) => {
				if (validateCron(cron)) {
					const job = scheduleSynchronizedJob(`${name}:${scheduleIndex}`, cron, async () => {
						if (this.options.schedule) {
							try {
								await handler();
							} catch (error) {
								logger.error(error);
							}
						}
					});

					scheduleIndex++;

					unregisterFunctions.push(async () => {
						await job.stop();
					});
				} else {
					this.handleExtensionError({ reason: `Couldn't register cron hook. Provided cron is invalid: ${cron}` });
				}
			},
			embed: (position: 'head' | 'body', code: string | EmbedHandler) => {
				const content = typeof code === 'function' ? code() : code;

				if (content.trim().length !== 0) {
					if (position === 'head') {
						const index = this.hookEmbedsHead.length;

						this.hookEmbedsHead.push(content);

						unregisterFunctions.push(() => {
							this.hookEmbedsHead.splice(index, 1);
						});
					} else {
						const index = this.hookEmbedsBody.length;

						this.hookEmbedsBody.push(content);

						unregisterFunctions.push(() => {
							this.hookEmbedsBody.splice(index, 1);
						});
					}
				} else {
					this.handleExtensionError({ reason: `Couldn't register embed hook. Provided code is empty!` });
				}
			},
		};

		hookRegistrationCallback(hookRegistrationContext, {
			services,
			env,
			database: getDatabase(),
			emitter: this.localEmitter,
			logger,
			getSchema,
			scopedCache: createScopedCacheExtensionHandle(getSchema),
		});

		return unregisterFunctions;
	}

	/**
	 * Register an individual endpoint
	 */
	private registerEndpoint(config: EndpointConfig, name: string): PromiseCallback {
		const logger = useLogger();

		const endpointRegistrationCallback = typeof config === 'function' ? config : config.handler;
		const nameWithoutType = name.includes(':') ? name.split(':')[0] : name;
		const routeName = typeof config === 'function' ? nameWithoutType : config.id;

		const scopedRouter = express.Router();

		this.endpointRouter.use(`/${routeName}`, scopedRouter);

		endpointRegistrationCallback(scopedRouter, {
			services,
			env,
			database: getDatabase(),
			emitter: this.localEmitter,
			logger,
			getSchema,
			scopedCache: createScopedCacheExtensionHandle(getSchema),
		});

		const unregisterFunction = () => {
			this.endpointRouter.stack = this.endpointRouter.stack.filter((layer) => scopedRouter !== layer.handle);
		};

		return unregisterFunction;
	}

	/**
	 * Register an individual operation
	 */
	private registerOperation(config: OperationApiConfig): PromiseCallback {
		const flowManager = getFlowManager();

		flowManager.addOperation(config.id, config.handler);

		const unregisterFunction = () => {
			flowManager.removeOperation(config.id);
		};

		return unregisterFunction;
	}

	/**
	 * Remove the registration for all API extensions
	 */
	private async unregisterApiExtensions(): Promise<void> {
		const unregisterFunctions = Array.from(this.unregisterFunctionMap.values());

		await Promise.all(unregisterFunctions.map((fn) => fn()));
	}

	/**
	 * If extensions must load successfully, any errors will cause the process to exit.
	 * Otherwise, the error will only be logged as a warning.
	 */
	private handleExtensionError({ error, reason }: { error?: unknown; reason: string }): void {
		const logger = useLogger();

		if (toBoolean(env['EXTENSIONS_MUST_LOAD'])) {
			logger.error('EXTENSION_MUST_LOAD is enabled and an extension failed to load.');
			logger.error(reason);
			if (error) logger.error(error);
			process.exit(1);
		} else {
			logger.warn(reason);
			if (error) logger.warn(error);
		}
	}
}

const APP_CHUNK_HASH_PLACEHOLDER = '__DIRECTUS_APP_CHUNK_HASH__';

/**
 * Hashes every chunk the bundling generated and stamps the hash into the entry,
 * so an app can tell the chunk it runs from the one the server now serves. Each
 * chunk is renamed into place whole, so a reader never gets the placeholder.
 */
async function writeStampedAppChunks(
	tempDir: string,
	output: readonly (
		| { type: 'chunk'; fileName: string; code: string; isEntry: boolean }
		| { type: 'asset' }
	)[],
): Promise<string> {
	const chunks = output.flatMap((chunk) => {
		return chunk.type === 'chunk'
			? [chunk]
			: [];
	});

	const hasher = createHash('sha256');

	const sortedChunks = [...chunks].sort(
		(left, right) => left.fileName.localeCompare(right.fileName),
	);

	for (const chunk of sortedChunks) {
		hasher.update(chunk.fileName).update(chunk.code);
	}

	const chunkHash = hasher.digest('hex');

	await mkdir(tempDir, { recursive: true });

	for (const chunk of sortedChunks) {
		const chunkPath = join(tempDir, chunk.fileName);
		const writingPath = `${chunkPath}.${process.pid}.tmp`;

		await writeFile(
			writingPath,
			chunk.isEntry
				? chunk.code.replace(APP_CHUNK_HASH_PLACEHOLDER, chunkHash)
				: chunk.code,
		);

		await rename(writingPath, chunkPath);
	}

	return chunkHash;
}

/** A bundle declaring its entries in code may ship no app side at all. */
async function withoutAppLessCodeBundles(
	extensions: Map<string, Extension>,
): Promise<Map<string, Extension>> {
	const kept = new Map<string, Extension>();

	for (const [folder, extension] of extensions) {
		const isAppLess = extension.type === 'bundle'
			&& extension.entriesFrom === 'code'
			&& !(await pathExists(path.resolve(extension.path, extension.entrypoint.app)));

		if (!isAppLess) {
			kept.set(folder, extension);
		}
	}

	return kept;
}
