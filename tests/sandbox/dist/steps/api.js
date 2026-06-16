import { getPort } from "../port.js";
import "../config.js";
import "../logger.js";
import { apiFolder } from "../sandbox.js";
import { spawn } from "child_process";
import { join } from "path";
import chalk from "chalk";

//#region src/steps/api.ts
async function buildApi(opts, logger, onRebuild) {
	const start = performance.now();
	logger.info("Rebuilding Directus");
	let timeout;
	const watch = opts.watch ? ["--watch", "--preserveWatchOutput"] : [];
	const inspect = opts.inspect ? ["--sourceMap"] : [];
	const build = spawn("pnpm", [
		"tsc",
		...watch,
		...inspect,
		"--project tsconfig.prod.json"
	], {
		cwd: apiFolder,
		shell: true
	});
	build.on("error", (err) => {
		logger.error(err.toString());
	});
	build.on("close", (code) => {
		if (code === null || code === 0) return;
		build.kill();
		const error = /* @__PURE__ */ new Error(`Building api stopped with error code ${code}`);
		clearTimeout(timeout);
		logger.error(error.toString());
		throw error;
	});
	logger.pipe(build.stderr, "error");
	if (opts.watch) {
		await new Promise((resolve$1, reject) => {
			build.stdout.on("data", (data) => {
				logger.debug(String(data));
				if (String(data).includes(`Watching for file changes.`)) {
					onRebuild();
					resolve$1(void 0);
				}
			});
			timeout = setTimeout(() => reject(/* @__PURE__ */ new Error("timeout building directus")), 6e4);
		});
		return build;
	} else {
		logger.pipe(build.stdout);
		await new Promise((resolve$1) => build.on("close", resolve$1));
		const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
		logger.info(`New Build Completed ${time}`);
		return;
	}
}
async function bootstrap(opts, env, logger) {
	const start = performance.now();
	logger.info("Bootstraping Database");
	let bootstrap$1;
	if (opts.dev) bootstrap$1 = spawn("pnpm", [
		"tsx",
		join(apiFolder, "src", "cli", "run.ts"),
		"bootstrap"
	], {
		env: { ...env },
		shell: true,
		stdio: "overlapped"
	});
	else bootstrap$1 = spawn("node", [join(apiFolder, "dist", "cli", "run.js"), "bootstrap"], { env: { ...env } });
	bootstrap$1.on("error", (err) => {
		bootstrap$1.kill();
		throw err;
	});
	logger.pipe(bootstrap$1.stdout, "debug");
	logger.pipe(bootstrap$1.stderr, "error");
	await new Promise((resolve$1) => bootstrap$1.on("close", resolve$1));
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	logger.info(`Completed Bootstraping Database ${time}`);
}
async function startApi(opts, env, logger) {
	const apiCount = Math.max(1, Number(opts.instances));
	const apiPorts = [...Array(apiCount).keys()].flatMap((i) => Number(env.PORT) + i * (opts.inspect ? 2 : 1));
	return await Promise.all(apiPorts.map(async (port) => {
		const newLogger = apiCount > 1 ? logger.addGroup(`API ${port}`) : logger;
		return startApiInstance({
			...opts,
			port
		}, {
			...env,
			PORT: String(port)
		}, newLogger);
	}));
}
async function startApiInstance(opts, env, logger) {
	const start = performance.now();
	logger.info("Starting Server");
	const inspector = await getPort(Number(opts.port) + 1);
	let api;
	const inspect = opts.inspect ? [`--inspect=${inspector}`] : [];
	if (opts.dev) api = spawn("pnpm ", [
		"tsx",
		...opts.watch ? ["watch", "--clear-screen=false"] : [],
		...inspect,
		join(apiFolder, "src", "start.ts")
	], {
		env,
		shell: true,
		stdio: "overlapped"
	});
	else api = spawn("node", [
		...inspect,
		join(apiFolder, "dist", "cli", "run.js"),
		"start"
	], { env });
	const { promise: startup, resolve: resolve$1, reject } = Promise.withResolvers();
	const timeout = setTimeout(() => reject(/* @__PURE__ */ new Error("timeout starting directus")), 6e4);
	api.on("error", (err) => {
		logger.error(err.toString());
	});
	api.on("close", (code) => {
		if (code === null || code === 0) return;
		const error = /* @__PURE__ */ new Error(`Api stopped with error code ${code}`);
		clearTimeout(timeout);
		logger.error(error.toString());
		reject(error);
	});
	api.stderr.on("data", (data) => {
		const msg = String(data);
		if (msg.startsWith("Debugger listening on ws://")) return;
		if (msg.startsWith("Debugger attached")) {
			logger.info(msg);
			return;
		}
		logger.error(msg);
	});
	api.stdout.on("data", (data) => {
		const msg = String(data);
		if (msg.includes(`Server started at http://${env.HOST}:${opts.port}`)) resolve$1();
		else if (msg.includes(`ERROR: Port ${opts.port} is already in use`)) reject(new Error(msg));
		else logger.debug(msg);
	});
	await startup;
	clearTimeout(timeout);
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	logger.info(`Server started at http://${env.HOST}:${opts.port}, Debugger listening on http://${env.HOST}:${inspector} ${time}`);
	if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD && env.ADMIN_TOKEN) logger.info(`User: ${chalk.cyan(env.ADMIN_EMAIL)} Password: ${chalk.cyan(env.ADMIN_PASSWORD)} Token: ${chalk.cyan(env.ADMIN_TOKEN)}`);
	return {
		process: api,
		port: opts.port,
		inspector
	};
}

//#endregion
export { bootstrap, buildApi, startApi };