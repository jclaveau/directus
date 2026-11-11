import { clone, debounce, isPlainObject } from "../utils/lodash-es-used.js";
import { useLogger } from "../logger/index.js";
import { useBus } from "../bus/lib/use-bus.js";
import "../bus/index.js";
import getModuleDefault from "../utils/get-module-default.js";
import database_default, { outstandingMigrations } from "../database/index.js";
import emitter_default, { Emitter } from "../emitter.js";
import { createScopedCacheExtensionHandle } from "./lib/scoped-cache-handle.js";
import { getSchema } from "../utils/get-schema.js";
import run from "../database/migrations/run.js";
import { JobQueue } from "../utils/job-queue.js";
import { validateCron } from "../utils/validate-cron.js";
import { scheduleSynchronizedJob } from "../utils/schedule.js";
import { getFlowManager } from "../flows.js";
import { deleteFromRequireCache } from "../utils/delete-from-require-cache.js";
import { trackSandboxCoverage } from "../utils/dump-coverage.js";
import { importFileUrl } from "../utils/import-file-url.js";
import { loadIsolatedVm } from "../utils/load-isolated-vm.js";
import { getRegistryRootPath } from "./lib/get-registry-root-path.js";
import { getExtensionsSettings } from "./lib/get-extensions-settings.js";
import { importCodeBundles, listMigrationEntries } from "./lib/import-code-bundles.js";
import { getExtensions } from "./lib/get-extensions.js";
import { getSharedDepsMapping } from "./lib/get-shared-deps-mapping.js";
import { getInstallationManager } from "./lib/installation/index.js";
import { generateApiExtensionsSandboxEntrypoint } from "./lib/sandbox/generate-api-extensions-sandbox-entrypoint.js";
import { instantiateSandboxSdk } from "./lib/sandbox/sdk/instantiate.js";
import { syncExtensions } from "./lib/sync-extensions.js";
import { wrapEmbeds } from "./lib/wrap-embeds.js";
import { services_exports } from "../services/index.js";
import { useEnv } from "@directus/env";
import express, { Router } from "express";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path, { dirname, join } from "node:path";
import { isTypeIn, toBoolean } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { processId } from "@directus/utils/node";
import os from "node:os";
import { HYBRID_EXTENSION_TYPES } from "@directus/constants";
import { pathExists } from "fs-extra";
import { APP_SHARED_DEPS } from "@directus/extensions";
import { generateExtensionsEntrypoint } from "@directus/extensions/node";
import alias from "@rollup/plugin-alias";
import nodeResolve from "@rollup/plugin-node-resolve";
import virtual from "@rollup/plugin-virtual";
import chokidar from "chokidar";
import { rolldown } from "rolldown";
import { rollup } from "rollup";
import { readBundleEntries } from "@directus/extensions/scalabus";
import DriverLocal from "@directus/storage-driver-local";

//#region src/extensions/manager.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = useEnv();
const defaultOptions = {
	schedule: true,
	watch: env["EXTENSIONS_AUTO_RELOAD"]
};
var ExtensionManager = class {
	options = defaultOptions;
	/**
	* Whether or not the extensions have been read from disk and registered into the system
	*/
	isLoaded = false;
	/**
	* Whether a load has already happened in this process. A reload has to bypass
	* the ESM module cache to pick a changed file up, but the very first load has
	* nothing to bypass — and the cache-busting query it would use also makes
	* Node's own compile cache miss every time.
	*/
	hasLoadedBefore = false;
	/**
	* The extensions the last successful load registered, which a failed reload
	* leaves in place for the retry to compare against.
	*/
	lastLoadedExtensions = [];
	registryExtensions = /* @__PURE__ */ new Map();
	moduleExtensions = /* @__PURE__ */ new Map();
	/**
	* Settings for the extensions that are loaded within the current process
	*/
	extensionsSettings = [];
	/**
	* Individual filename chunks from the rollup bundle. Used to improve the performance by allowing
	* extensions to split up their bundle into multiple smaller chunks
	*/
	appExtensionChunks = [];
	/**
	* The hash of the app chunks the last bundling wrote, which the app compares
	* against the one it runs to tell it was rebuilt.
	*/
	appChunkHash = null;
	/**
	* The bundles declaring their entries in code, with their imported api
	* entries.
	*/
	codeBundles = [];
	/**
	* Callbacks to be able to unregister extensions
	*/
	unregisterFunctionMap = /* @__PURE__ */ new Map();
	/**
	* A local-to-extensions scoped emitter that can be used to fire and listen to custom events
	* between extensions. These events are completely isolated from the core events that trigger
	* hooks etc
	*/
	localEmitter = new Emitter();
	/**
	* Locally scoped express router used for custom endpoints. Allows extensions to dynamically
	* register and de-register endpoints without affecting the regular global router
	*/
	endpointRouter = Router();
	/**
	* Custom HTML to be injected at the end of the `<head>` tag of the app's index.html
	*/
	hookEmbedsHead = [];
	/**
	* Custom HTML to be injected at the end of the `<body>` tag of the app's index.html
	*/
	hookEmbedsBody = [];
	/**
	* Used to prevent race conditions when reloading extensions. Forces each reload to happen in
	* sequence.
	*/
	reloadQueue = new JobQueue();
	/** The reload waiting behind the running one, which later callers share. */
	queuedReload = null;
	/** What the queued reload loads with, forced if any caller sharing it asked. */
	queuedReloadOptions = void 0;
	/**
	* Optional file system watcher to auto-reload extensions when the local file system changes
	*/
	watcher = null;
	/**
	* installation manager responsible for installing extensions from registries
	*/
	installationManager = getInstallationManager();
	messenger = useBus();
	/**
	* channel to publish on registering extension from external registry
	*/
	reloadChannel = `extensions.reload`;
	processId = processId();
	get extensions() {
		return [...this.registryExtensions.values(), ...this.moduleExtensions.values()];
	}
	/**
	* The `defineMigration`s of the installed bundles, as the last load
	* read them.
	*/
	migrationEntries() {
		return listMigrationEntries(this.codeBundles);
	}
	getAppChunkHash() {
		return this.appChunkHash;
	}
	getExtension(source, folder) {
		switch (source) {
			case "module": return this.moduleExtensions.get(folder);
			case "registry": return this.registryExtensions.get(folder);
		}
	}
	/**
	* Load and register all extensions
	*
	* @param {ExtensionManagerOptions} options - Extension manager configuration options
	* @param {boolean} options.schedule - Whether or not to allow for scheduled (CRON) hook extensions
	* @param {boolean} options.watch - Whether or not to watch the local extensions folder for changes
	*/
	async initialize(options = {}) {
		const logger = useLogger();
		this.options = {
			...defaultOptions,
			...options
		};
		const wasWatcherInitialized = this.watcher !== null;
		if (this.options.watch && !wasWatcherInitialized) this.initializeWatcher();
		else if (!this.options.watch && wasWatcherInitialized) await this.closeWatcher();
		if (!this.isLoaded) {
			await this.load();
			if (this.extensions.length > 0) logger.info(`Loaded extensions: ${this.extensions.map((ext) => ext.name).join(", ")}`);
		}
		if (this.options.watch && !wasWatcherInitialized) this.updateWatchedExtensions([...this.extensions]);
		this.messenger.subscribe(this.reloadChannel, (payload) => {
			if (isPlainObject(payload) && "origin" in payload && payload["origin"] === this.processId) return;
			this.reloadLoggingFailure("a request from another process");
		});
	}
	/**
	* Installs an external extension from registry
	*/
	async install(versionId) {
		const logger = useLogger();
		await this.installationManager.install(versionId);
		await this.reload({ forceSync: true });
		emitter_default.emitAction("extensions.installed", {
			extensions: this.extensions,
			versionId
		});
		logger.info(`Installed extension: ${versionId}`);
		await this.broadcastReloadNotification();
	}
	async uninstall(folder) {
		const logger = useLogger();
		await this.installationManager.uninstall(folder);
		await this.reload({ forceSync: true });
		emitter_default.emitAction("extensions.uninstalled", {
			extensions: this.extensions,
			folder
		});
		logger.info(`Uninstalled extension: ${folder}`);
		await this.broadcastReloadNotification();
	}
	async broadcastReloadNotification() {
		await this.messenger.publish(this.reloadChannel, { origin: this.processId });
	}
	/**
	* Load all extensions from disk and register them in their respective places
	*/
	async load(options) {
		const logger = useLogger();
		if (env["EXTENSIONS_LOCATION"]) try {
			await syncExtensions({ force: options?.forceSync ?? false });
		} catch (error) {
			logger.error(`Failed to sync extensions`);
			logger.error(error);
			process.exit(1);
		}
		try {
			const { registry, module } = await getExtensions();
			this.registryExtensions = registry;
			this.moduleExtensions = module;
			await this.importCodeBundles();
			this.extensionsSettings = await getExtensionsSettings({
				registry,
				module
			});
		} catch (error) {
			this.handleExtensionError({
				error,
				reason: `Couldn't load extensions`
			});
		}
		if (options?.migrate) await this.migrateBeforeSchema();
		await Promise.all([this.registerInternalOperations(), this.registerApiExtensions()]);
		this.hasLoadedBefore = true;
		if (env["SERVE_APP"]) await this.generateExtensionBundle();
		this.isLoaded = true;
		this.lastLoadedExtensions = clone(this.extensions);
		emitter_default.emitAction("extensions.load", { extensions: this.extensions });
		logger.info("Extensions loaded");
	}
	/**
	* Imports the api side of the bundles declaring their entries in code, and
	* lists their api entries — migrations aside, which get no settings row —
	* so the settings sync sees them.
	*/
	async importCodeBundles() {
		const { codeBundles, failures } = await importCodeBundles({
			module: this.moduleExtensions,
			registry: this.registryExtensions
		}, { fresh: this.hasLoadedBefore });
		this.codeBundles = codeBundles;
		for (const { name, error } of failures) this.handleExtensionError({
			error,
			reason: `Couldn't import bundle "${name}"`
		});
		for (const codeBundle of codeBundles) {
			const extension = this.getExtension(codeBundle.source, codeBundle.folder);
			if (extension?.type !== "bundle") continue;
			extension.entries = codeBundle.entries.flatMap((entry) => {
				return entry.type === "migration" ? [] : [{
					type: entry.type,
					name: entry.name
				}];
			});
		}
	}
	/**
	* Runs the before-schema migrations a changed bundle brings, for
	* `EXTENSIONS_AUTO_MIGRATE`. The after-schema ones wait on a snapshot, which
	* only `migrate:latest --snapshot` applies, so they are only named.
	*/
	async migrateBeforeSchema() {
		const logger = useLogger();
		const extensionMigrations = this.migrationEntries();
		await run(database_default(), "latest", true, {
			extensionMigrations,
			phase: "before-schema"
		});
		const pendingAfterSchema = (await outstandingMigrations(extensionMigrations.filter(({ config }) => config.phase === "after-schema"))).filter((version) => version.includes(":"));
		if (pendingAfterSchema.length > 0) logger.warn(`Migrations waiting on a schema snapshot: ${pendingAfterSchema.join(", ")}; run "directus database migrate:latest --snapshot <path>"`);
	}
	/**
	* Unregister all extensions from the current process
	*/
	async unload() {
		await this.unregisterApiExtensions();
		this.localEmitter.offAll();
		this.isLoaded = false;
		emitter_default.emitAction("extensions.unload", { extensions: this.extensions });
		useLogger().info("Extensions unloaded");
	}
	/**
	* Reload all the extensions. Will unload if extensions have already been loaded
	*/
	reload(options) {
		if (this.queuedReload !== null) {
			this.queuedReloadOptions = {
				forceSync: Boolean(this.queuedReloadOptions?.forceSync || options?.forceSync),
				migrate: Boolean(this.queuedReloadOptions?.migrate || options?.migrate)
			};
			return this.queuedReload;
		}
		const logger = useLogger();
		let resolve$1;
		let reject;
		const promise = new Promise((res, rej) => {
			resolve$1 = res;
			reject = rej;
		});
		const reloadExtensions = async (reloadOptions) => {
			if (this.hasLoadedBefore) {
				const prevExtensions = this.lastLoadedExtensions;
				await this.unload();
				await this.load(reloadOptions);
				logger.info("Extensions reloaded");
				const added = this.extensions.filter((extension) => !prevExtensions.some((prevExtension) => extension.path === prevExtension.path));
				const removed = prevExtensions.filter((prevExtension) => !this.extensions.some((extension) => prevExtension.path === extension.path));
				this.updateWatchedExtensions(added, removed);
				const addedExtensions = added.map((extension) => extension.name);
				const removedExtensions = removed.map((extension) => extension.name);
				emitter_default.emitAction("extensions.reload", {
					extensions: this.extensions,
					added: addedExtensions,
					removed: removedExtensions
				});
				if (addedExtensions.length > 0) logger.info(`Added extensions: ${addedExtensions.join(", ")}`);
				if (removedExtensions.length > 0) logger.info(`Removed extensions: ${removedExtensions.join(", ")}`);
				resolve$1();
			} else {
				logger.warn("Extensions have to be loaded before they can be reloaded");
				reject(/* @__PURE__ */ new Error("Extensions have to be loaded before they can be reloaded"));
			}
		};
		this.queuedReload = promise;
		this.queuedReloadOptions = options;
		this.reloadQueue.enqueue(async () => {
			const reloadOptions = this.queuedReloadOptions;
			this.queuedReload = null;
			this.queuedReloadOptions = void 0;
			try {
				await reloadExtensions(reloadOptions);
			} catch (error) {
				reject(error);
			}
		});
		return promise;
	}
	/**
	* Return the previously generated app extension bundle chunk by name.
	* Providing no name will return the entry bundle.
	*/
	async getAppExtensionChunk(name) {
		let file;
		if (!name) file = this.appExtensionChunks[0];
		else if (this.appExtensionChunks.includes(name)) file = name;
		if (!file) return null;
		const tmpStorage = new DriverLocal({ root: join(env["TEMP_PATH"], "app-extensions") });
		if (await tmpStorage.exists(file) === false) return null;
		return await tmpStorage.read(file);
	}
	/**
	* Return the scoped router for custom endpoints
	*/
	getEndpointRouter() {
		return this.endpointRouter;
	}
	/**
	* Return the custom HTML head and body embeds wrapped in a marker comment
	*/
	getEmbeds() {
		return {
			head: wrapEmbeds("Custom Embed Head", this.hookEmbedsHead),
			body: wrapEmbeds("Custom Embed Body", this.hookEmbedsBody)
		};
	}
	/** For the callers nothing awaits, whose rejection would be unhandled. */
	reloadLoggingFailure(trigger) {
		this.reload().catch((error) => {
			useLogger().error(error, `Failed to reload the extensions on ${trigger}`);
		});
	}
	/**
	* Start the chokidar watcher for extensions on the local filesystem
	*/
	initializeWatcher() {
		useLogger().info("Watching extensions for changes...");
		const changeTrigger = "a change in the extension packages";
		const reloadOnChange = () => {
			this.reload({ migrate: env["EXTENSIONS_AUTO_MIGRATE"] === true }).catch((error) => {
				useLogger().error(error, `Failed to reload the extensions on ${changeTrigger}`);
			});
		};
		this.watcher = chokidar.watch([path.resolve("package.json")], {
			ignoreInitial: true,
			followSymlinks: os.platform() === "darwin" ? false : true
		});
		this.watcher.on("add", debounce(reloadOnChange, 500)).on("change", debounce(reloadOnChange, 650)).on("unlink", debounce(reloadOnChange, 2e3));
	}
	/**
	* Close and destroy the local filesystem watcher if enabled
	*/
	async closeWatcher() {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
	/**
	* Update the chokidar watcher configuration when new extensions are added or existing ones
	* removed
	*/
	updateWatchedExtensions(added, removed = []) {
		if (!this.watcher) return;
		const registryDir = path.join(path.resolve(getRegistryRootPath()), ".registry");
		const toPackageExtensionPaths = (extensions) => extensions.filter((extension) => extension.local && !extension.path.startsWith(registryDir)).flatMap((extension) => isTypeIn(extension, HYBRID_EXTENSION_TYPES) || extension.type === "bundle" ? [path.resolve(extension.path, extension.entrypoint.app), path.resolve(extension.path, extension.entrypoint.api)] : path.resolve(extension.path, extension.entrypoint));
		this.watcher.add(toPackageExtensionPaths(added));
		this.watcher.unwatch(toPackageExtensionPaths(removed));
	}
	/**
	* Uses rollup to bundle the app extensions together into a single file the app can download and
	* run.
	*/
	async generateExtensionBundle() {
		const logger = useLogger();
		const env$1 = useEnv();
		const sharedDepsMapping = await getSharedDepsMapping(APP_SHARED_DEPS);
		const internalImports = Object.entries(sharedDepsMapping).map(([name, path$1]) => ({
			find: name,
			replacement: path$1
		}));
		const entrypoint = generateExtensionsEntrypoint({
			module: await withoutAppLessCodeBundles(this.moduleExtensions),
			registry: await withoutAppLessCodeBundles(this.registryExtensions)
		}, this.extensionsSettings) + `
export const chunkHash = ${JSON.stringify(APP_CHUNK_HASH_PLACEHOLDER)};\n`;
		try {
			const bundle = await (env$1["EXTENSIONS_ROLLDOWN"] ?? false ? rolldown : rollup)({
				input: "entry",
				external: Object.values(sharedDepsMapping),
				makeAbsoluteExternalsRelative: false,
				plugins: [
					virtual({ entry: entrypoint }),
					alias({ entries: internalImports }),
					nodeResolve({ browser: true })
				]
			});
			const tempDir = join(env$1["TEMP_PATH"], "app-extensions");
			const { output } = await bundle.generate({ format: "es" });
			this.appExtensionChunks = output.reduce((acc, chunk) => {
				if (chunk.type === "chunk") acc.push(chunk.fileName);
				return acc;
			}, []);
			this.appChunkHash = await writeStampedAppChunks(tempDir, output);
			await bundle.close();
		} catch (error) {
			logger.warn(`Couldn't bundle App extensions`);
			logger.warn(error);
		}
	}
	async registerSandboxedApiExtension(extension) {
		const logger = useLogger();
		const sandboxMemory = Number(env["EXTENSIONS_SANDBOX_MEMORY"]);
		const sandboxTimeout = Number(env["EXTENSIONS_SANDBOX_TIMEOUT"]);
		const entrypointPath = path.resolve(extension.path, isTypeIn(extension, HYBRID_EXTENSION_TYPES) ? extension.entrypoint.api : extension.entrypoint);
		const extensionCode = await readFile(entrypointPath, "utf-8");
		const ivm = await loadIsolatedVm();
		const isolate = new ivm.Isolate({
			memoryLimit: sandboxMemory,
			onCatastrophicError: (error) => {
				logger.error(`Error in API extension sandbox of ${extension.type} "${extension.name}"`);
				logger.error(error);
				process.abort();
			}
		});
		const context = await isolate.createContext();
		context.global.setSync("process", { env: { NODE_ENV: process.env["NODE_ENV"] ?? "production" } }, { copy: true });
		const module = await isolate.compileModule(extensionCode, { filename: `file://${entrypointPath}` });
		const sdkModule = await instantiateSandboxSdk(isolate, extension.sandbox?.requestedScopes ?? {});
		await module.instantiate(context, (specifier) => {
			if (specifier !== "directus:api") throw new Error("Imports other than \"directus:api\" are prohibited in API extension sandboxes");
			return sdkModule;
		});
		await module.evaluate({ timeout: sandboxTimeout });
		const releaseSandboxCoverage = await context.eval("globalThis.__coverage__ !== undefined", { timeout: sandboxTimeout }) ? trackSandboxCoverage(async () => {
			return JSON.parse(await context.eval("JSON.stringify({ coverage: globalThis.__coverage__, coverageDirs: globalThis.__extensionCoverageDirs ?? [] })", { timeout: sandboxTimeout }));
		}, extension.name) : void 0;
		const cb = await module.namespace.get("default", { reference: true });
		const { code, hostFunctions, unregisterFunction } = generateApiExtensionsSandboxEntrypoint(extension.type, extension.name, this.endpointRouter);
		await context.evalClosure(code, [cb, ...hostFunctions.map((fn) => new ivm.Reference(fn))], {
			timeout: sandboxTimeout,
			filename: "<extensions-sandbox>"
		});
		this.unregisterFunctionMap.set(extension.name, async () => {
			try {
				await unregisterFunction();
				await releaseSandboxCoverage?.();
			} finally {
				if (!isolate.isDisposed) isolate.dispose();
			}
		});
	}
	async registerApiExtensions() {
		const sources = {
			module: this.moduleExtensions,
			registry: this.registryExtensions
		};
		await Promise.all(Object.entries(sources).map(async ([source, extensions]) => {
			await Promise.all(Array.from(extensions.entries()).map(async ([folder, extension]) => {
				const { id, enabled } = this.extensionsSettings.find((settings) => settings.source === source && settings.folder === folder) ?? { enabled: false };
				if (!enabled) return;
				switch (extension.type) {
					case "hook":
						await this.registerHookExtension(extension);
						break;
					case "endpoint":
						await this.registerEndpointExtension(extension);
						break;
					case "operation":
						await this.registerOperationExtension(extension);
						break;
					case "bundle":
						await this.registerBundleExtension(extension, source, id);
						break;
					default: return;
				}
			}));
		}));
	}
	async registerHookExtension(hook) {
		try {
			if (hook.sandbox?.enabled) await this.registerSandboxedApiExtension(hook);
			else {
				const hookPath = path.resolve(hook.path, hook.entrypoint);
				const config = getModuleDefault(await importFileUrl(hookPath, import.meta.url, { fresh: this.hasLoadedBefore }));
				const unregisterFunctions = this.registerHook(config, hook.name);
				this.unregisterFunctionMap.set(hook.name, async () => {
					await Promise.all(unregisterFunctions.map((fn) => fn()));
					deleteFromRequireCache(hookPath);
				});
			}
		} catch (error) {
			this.handleExtensionError({
				error,
				reason: `Couldn't register hook "${hook.name}"`
			});
		}
	}
	async registerEndpointExtension(endpoint) {
		try {
			if (endpoint.sandbox?.enabled) await this.registerSandboxedApiExtension(endpoint);
			else {
				const endpointPath = path.resolve(endpoint.path, endpoint.entrypoint);
				const config = getModuleDefault(await importFileUrl(endpointPath, import.meta.url, { fresh: this.hasLoadedBefore }));
				const unregister = this.registerEndpoint(config, endpoint.name);
				this.unregisterFunctionMap.set(endpoint.name, async () => {
					await unregister();
					deleteFromRequireCache(endpointPath);
				});
			}
		} catch (error) {
			this.handleExtensionError({
				error,
				reason: `Couldn't register endpoint "${endpoint.name}"`
			});
		}
	}
	async registerOperationExtension(operation) {
		try {
			if (operation.sandbox?.enabled) await this.registerSandboxedApiExtension(operation);
			else {
				const operationPath = path.resolve(operation.path, operation.entrypoint.api);
				const config = getModuleDefault(await importFileUrl(operationPath, import.meta.url, { fresh: this.hasLoadedBefore }));
				const unregister = this.registerOperation(config);
				this.unregisterFunctionMap.set(operation.name, async () => {
					await unregister();
					deleteFromRequireCache(operationPath);
				});
			}
		} catch (error) {
			this.handleExtensionError({
				error,
				reason: `Couldn't register operation "${operation.name}"`
			});
		}
	}
	async registerBundleExtension(bundle, source, bundleId) {
		const extensionEnabled = (extensionName) => {
			const settings = this.extensionsSettings.find((settings$1) => settings$1.source === source && settings$1.folder === extensionName && settings$1.bundle === bundleId);
			if (!settings) return false;
			return settings.enabled;
		};
		try {
			const bundlePath = path.resolve(bundle.path, bundle.entrypoint.api);
			const codeBundle = this.codeBundles.find((candidate) => {
				return candidate.source === source && candidate.apiPath === bundlePath;
			});
			if (bundle.entriesFrom === "code" && !codeBundle) return;
			const bundleEntries = codeBundle?.entries ?? readBundleEntries(getModuleDefault(await importFileUrl(bundlePath, import.meta.url, { fresh: this.hasLoadedBefore })));
			const unregisterFunctions = [];
			for (const entry of bundleEntries) {
				if (entry.type === "migration" || !extensionEnabled(entry.name)) continue;
				if (entry.type === "hook") unregisterFunctions.push(...this.registerHook(entry.config, entry.name));
				else if (entry.type === "endpoint") unregisterFunctions.push(this.registerEndpoint(entry.config, entry.name));
				else unregisterFunctions.push(this.registerOperation(entry.config));
			}
			this.unregisterFunctionMap.set(bundle.name, async () => {
				await Promise.all(unregisterFunctions.map((fn) => fn()));
				deleteFromRequireCache(bundlePath);
			});
		} catch (error) {
			this.handleExtensionError({
				error,
				reason: `Couldn't register bundle "${bundle.name}"`
			});
		}
	}
	/**
	* Import the operation module code for all operation extensions, and register them individually through
	* registerOperation
	*/
	async registerInternalOperations() {
		const internalOperations = await readdir(path.join(__dirname, "..", "operations"));
		for (const operation of internalOperations) {
			const config = getModuleDefault(await import(`../operations/${operation}/index.js`));
			this.registerOperation(config);
		}
	}
	/**
	* Register a single hook
	*/
	registerHook(hookRegistrationCallback, name) {
		const logger = useLogger();
		let scheduleIndex = 0;
		const unregisterFunctions = [];
		hookRegistrationCallback({
			filter: (event, handler) => {
				emitter_default.onFilter(event, handler);
				unregisterFunctions.push(() => {
					emitter_default.offFilter(event, handler);
				});
			},
			action: (event, handler) => {
				emitter_default.onAction(event, handler);
				unregisterFunctions.push(() => {
					emitter_default.offAction(event, handler);
				});
			},
			init: (event, handler) => {
				emitter_default.onInit(event, handler);
				unregisterFunctions.push(() => {
					emitter_default.offInit(name, handler);
				});
			},
			schedule: (cron, handler) => {
				if (validateCron(cron)) {
					const job = scheduleSynchronizedJob(`${name}:${scheduleIndex}`, cron, async () => {
						if (this.options.schedule) try {
							await handler();
						} catch (error) {
							logger.error(error);
						}
					});
					scheduleIndex++;
					unregisterFunctions.push(async () => {
						await job.stop();
					});
				} else this.handleExtensionError({ reason: `Couldn't register cron hook. Provided cron is invalid: ${cron}` });
			},
			embed: (position, code) => {
				const content = typeof code === "function" ? code() : code;
				if (content.trim().length !== 0) if (position === "head") {
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
				else this.handleExtensionError({ reason: `Couldn't register embed hook. Provided code is empty!` });
			}
		}, {
			services: services_exports,
			env,
			database: database_default(),
			emitter: this.localEmitter,
			logger,
			getSchema,
			scopedCache: createScopedCacheExtensionHandle(getSchema)
		});
		return unregisterFunctions;
	}
	/**
	* Register an individual endpoint
	*/
	registerEndpoint(config, name) {
		const logger = useLogger();
		const endpointRegistrationCallback = typeof config === "function" ? config : config.handler;
		const nameWithoutType = name.includes(":") ? name.split(":")[0] : name;
		const routeName = typeof config === "function" ? nameWithoutType : config.id;
		const scopedRouter = express.Router();
		this.endpointRouter.use(`/${routeName}`, scopedRouter);
		endpointRegistrationCallback(scopedRouter, {
			services: services_exports,
			env,
			database: database_default(),
			emitter: this.localEmitter,
			logger,
			getSchema,
			scopedCache: createScopedCacheExtensionHandle(getSchema)
		});
		const unregisterFunction = () => {
			this.endpointRouter.stack = this.endpointRouter.stack.filter((layer) => scopedRouter !== layer.handle);
		};
		return unregisterFunction;
	}
	/**
	* Register an individual operation
	*/
	registerOperation(config) {
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
	async unregisterApiExtensions() {
		const unregisterFunctions = Array.from(this.unregisterFunctionMap.values());
		await Promise.all(unregisterFunctions.map((fn) => fn()));
	}
	/**
	* If extensions must load successfully, any errors will cause the process to exit.
	* Otherwise, the error will only be logged as a warning.
	*/
	handleExtensionError({ error, reason }) {
		const logger = useLogger();
		if (toBoolean(env["EXTENSIONS_MUST_LOAD"])) {
			logger.error("EXTENSION_MUST_LOAD is enabled and an extension failed to load.");
			logger.error(reason);
			if (error) logger.error(error);
			process.exit(1);
		} else {
			logger.warn(reason);
			if (error) logger.warn(error);
		}
	}
};
const APP_CHUNK_HASH_PLACEHOLDER = "__DIRECTUS_APP_CHUNK_HASH__";
/**
* Hashes every chunk the bundling generated and stamps the hash into the entry,
* so an app can tell the chunk it runs from the one the server now serves. Each
* chunk is renamed into place whole, so a reader never gets the placeholder.
*/
async function writeStampedAppChunks(tempDir, output) {
	const chunks = output.flatMap((chunk) => {
		return chunk.type === "chunk" ? [chunk] : [];
	});
	const hasher = createHash("sha256");
	const sortedChunks = [...chunks].sort((left, right) => left.fileName.localeCompare(right.fileName));
	for (const chunk of sortedChunks) hasher.update(chunk.fileName).update(chunk.code);
	const chunkHash = hasher.digest("hex");
	await mkdir(tempDir, { recursive: true });
	for (const chunk of sortedChunks) {
		const chunkPath = join(tempDir, chunk.fileName);
		const writingPath = `${chunkPath}.${process.pid}.tmp`;
		await writeFile(writingPath, chunk.isEntry ? chunk.code.replace(APP_CHUNK_HASH_PLACEHOLDER, chunkHash) : chunk.code);
		await rename(writingPath, chunkPath);
	}
	return chunkHash;
}
/** A bundle declaring its entries in code may ship no app side at all. */
async function withoutAppLessCodeBundles(extensions) {
	const kept = /* @__PURE__ */ new Map();
	for (const [folder, extension] of extensions) if (!(extension.type === "bundle" && extension.entriesFrom === "code" && !await pathExists(path.resolve(extension.path, extension.entrypoint.app)))) kept.set(folder, extension);
	return kept;
}

//#endregion
export { ExtensionManager };