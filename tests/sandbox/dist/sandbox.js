import { directusFolder } from "./find-directus.js";
import { getPort } from "./port.js";
import { getEnv } from "./config.js";
import { kill } from "./kill.js";
import { createLogger } from "./logger.js";
import { startApp } from "./steps/app.js";
import { bootstrap, buildApi, startApi } from "./steps/api.js";
import { createDatabase } from "./steps/database.js";
import { dockerUp } from "./steps/docker.js";
import { loadSchema, saveSchema } from "./steps/schema.js";
import "./steps/index.js";
import { startLicenseServer } from "./steps/license.js";
import { join } from "path";
import chalk from "chalk";
import { merge } from "lodash-es";

//#region src/sandbox.ts
async function getOptions(options) {
	if (options?.schema === true) options.schema = "snapshot.json";
	return merge({
		build: false,
		dev: false,
		watch: false,
		port: await getPort(options?.port ?? process.env["PORT"] ?? 8055),
		app: false,
		dbVersion: void 0,
		docker: {
			keep: false,
			port: void 0,
			name: void 0,
			suffix: ""
		},
		instances: "1",
		inspect: true,
		env: {},
		prefix: void 0,
		schema: void 0,
		silent: false,
		export: false,
		extras: {
			redis: false,
			maildev: false,
			minio: false,
			saml: false,
			license: false
		},
		cache: false,
		skipSetup: false,
		knex: false,
		hooks: {}
	}, options);
}
const apiFolder = join(directusFolder, "api");
const appFolder = join(directusFolder, "app");
const licenseFolder = join(directusFolder, "tests/mock-license-server");
const databases = [
	"maria",
	"cockroachdb",
	"mssql",
	"mysql",
	"oracle",
	"postgres",
	"sqlite"
];
async function sandboxes(sandboxOptions, options) {
	if (!sandboxOptions.every((sandbox$1) => databases.includes(sandbox$1.database))) throw new Error("Invalid database provided");
	const opts = await getOptions(options);
	const logger = createLogger(process.env, opts);
	let sandboxes$1 = [];
	let build;
	const projects = [];
	let license;
	if (opts.extras.license) license = await startLicenseServer(await getEnv("sqlite", opts), logger);
	try {
		if (opts.build && !opts.dev) build = await buildApi(opts, logger, restartApis);
		await Promise.all(sandboxOptions.map(async ({ database, options: options$1 }, index) => {
			const opts$1 = await getOptions(options$1);
			const env = await getEnv(database, opts$1);
			const logger$1 = opts$1.prefix ? createLogger(env, opts$1, opts$1.prefix) : createLogger(env, opts$1);
			let knex;
			try {
				const project = await dockerUp(database, opts$1, env, logger$1);
				if (project) projects.push({
					project,
					logger: logger$1,
					env
				});
				await bootstrap(opts$1, env, logger$1);
				if (opts$1.schema) await loadSchema(opts$1.schema, env, logger$1);
				if (opts$1.knex) knex = createDatabase(env, logger$1);
				await opts$1.hooks.beforeApi?.({
					env,
					logger: logger$1,
					knex
				});
				sandboxes$1[index] = {
					apis: await startApi(opts$1, env, logger$1),
					opts: opts$1,
					env,
					logger: logger$1,
					knex
				};
			} catch (e) {
				logger$1.error(String(e));
				throw e;
			}
		}));
	} catch (e) {
		await stop();
		throw e;
	}
	async function restartApis() {
		sandboxes$1.forEach((api) => api.apis.forEach((api$1) => kill(api$1.process)));
		sandboxes$1 = await Promise.all(sandboxes$1.map(async (api) => ({
			...api,
			processes: await startApi(api.opts, api.env, api.logger)
		})));
	}
	async function stop() {
		kill(build);
		await Promise.all(sandboxes$1.map((sandbox$1) => sandbox$1.knex?.destroy()));
		for (const sandbox$1 of sandboxes$1) for (const api of sandbox$1.apis) kill(api.process);
		kill(license);
	}
	return {
		sandboxes: sandboxes$1,
		stop,
		restartApis
	};
}
async function sandbox(database, options) {
	if (!databases.includes(database)) throw new Error("Invalid database provided");
	const opts = await getOptions(options);
	const env = await getEnv(database, opts);
	const logger = opts.prefix ? createLogger(env, opts, opts.prefix) : createLogger(env, opts);
	let apis;
	let app;
	let build;
	let interval;
	let license;
	let knex;
	try {
		if (opts.build && !opts.dev) build = await buildApi(opts, logger, restartApi);
		if (opts.extras.license) license = await startLicenseServer(env, logger);
		await dockerUp(database, opts, env, logger);
		await bootstrap(opts, env, logger);
		if (opts.schema) await loadSchema(opts.schema, env, logger);
		if (opts.knex) knex = createDatabase(env, logger);
		await opts.hooks.beforeApi?.({
			env,
			logger,
			knex
		});
		apis = await startApi(opts, env, logger);
		if (opts.app !== false) app = await startApp(opts, env, logger);
		if (opts.export) interval = await saveSchema(env);
	} catch (err) {
		logger.error(err.toString());
		await stop();
		throw err;
	}
	async function restartApi() {
		apis?.forEach((api) => kill(api.process));
		const resolvedPort = await getPort(opts.port);
		if (resolvedPort !== opts.port) {
			opts.port = resolvedPort;
			env.PORT = String(resolvedPort);
			const publicUrl = new URL(env.PUBLIC_URL);
			publicUrl.port = String(resolvedPort);
			env.PUBLIC_URL = publicUrl.toString().replace(/\/$/, "");
		}
		apis = await startApi(opts, env, logger);
	}
	async function stop() {
		const start = performance.now();
		logger.info("Stopping sandbox");
		clearInterval(interval);
		kill(build);
		if (knex) await knex.destroy();
		for (const api of apis ?? []) kill(api.process);
		kill(app);
		kill(license);
		const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
		logger.info(`Stopped sandbox ${time}`);
	}
	return {
		stop,
		restartApi,
		env,
		logger,
		get apis() {
			return apis;
		},
		knex
	};
}

//#endregion
export { apiFolder, appFolder, databases, licenseFolder, sandbox, sandboxes };