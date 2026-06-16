import { getPort } from "../port.js";
import { appFolder } from "../sandbox.js";
import { spawn } from "child_process";
import chalk from "chalk";

//#region src/steps/app.ts
async function startApp(opts, env, logger) {
	const start = performance.now();
	logger.info("Starting App");
	let timeout;
	const port = await getPort(typeof opts.app !== "boolean" ? opts.app : 8080);
	const app = spawn("pnpm", [
		"vite",
		"--host",
		"--clearScreen false",
		`--port ${port}`
	], {
		cwd: appFolder,
		shell: true
	});
	logger.pipe(app.stdout, "debug");
	app.on("error", (err) => {
		logger.error(err.toString());
	});
	app.on("close", (code) => {
		if (code === null || code === 0) return;
		const error = /* @__PURE__ */ new Error(`Api stopped with error code ${code}`);
		clearTimeout(timeout);
		logger.error(error.toString());
		throw error;
	});
	logger.pipe(app.stderr, "error");
	await new Promise((resolve, reject) => {
		app.stdout.on("data", (data) => {
			const msg = String(data);
			if (msg.includes(`ready in`)) resolve(void 0);
			else logger.debug(msg);
		});
		timeout = setTimeout(() => {
			reject(/* @__PURE__ */ new Error("timeout starting app"));
		}, 6e4);
	});
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	logger.info(`App started at http://${env.HOST}:${port} ${time}`);
	return app;
}

//#endregion
export { startApp };