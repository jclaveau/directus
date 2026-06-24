import "../config.js";
import "../logger.js";
import { spawn, spawnSync } from "child_process";
import { dirname, join } from "path";
import chalk from "chalk";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { fileURLToPath } from "url";

//#region src/steps/docker.ts
const folderName = dirname(fileURLToPath(import.meta.url));
async function dockerUp(database, opts, env, logger) {
	const { license: _,...extras } = opts.extras;
	const extrasList = Object.entries(extras).filter(([_$1, value]) => value).map(([key, _$1]) => key);
	const project = opts.docker.name ?? `sandbox_${database}${extrasList.map((extra) => "_" + extra).join("")}` + (opts.docker.suffix ? `_${opts.docker.suffix}` : "");
	const files = database === "sqlite" ? extrasList : [database, ...extrasList];
	const start = performance.now();
	if (files.length > 0) {
		logger.info("Starting up Docker containers");
		if (spawnSync("docker", ["ps"]).status !== 0) {
			logger.error("Docker is not running or installation is missing");
			process.exit(1);
		}
		if (!opts.docker.keep) {
			logger.info("Removing old containers");
			await dockerDown(project, env, logger);
		}
		const docker = spawn("docker", [
			"compose",
			"-p",
			project,
			...files.flatMap((file) => ["-f", join(folderName, "..", "docker", `${file}.yml`)]),
			"up",
			"-d",
			"--wait"
		], { env: {
			...env,
			COMPOSE_STATUS_STDOUT: "1"
		} });
		docker.on("error", (err) => {
			docker.kill();
			throw err;
		});
		logger.pipe(docker.stdout, "debug");
		logger.pipe(docker.stderr, "debug");
		await new Promise((resolve$1) => docker.on("close", resolve$1));
	}
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	if ("DB_PORT" in env) {
		logger.info(`Database started at ${env.DB_HOST}:${env.DB_PORT}/${env.DB_DATABASE} ${time}`);
		logger.info(`User: ${chalk.cyan(env.DB_USER)} Password: ${chalk.cyan(env.DB_PASSWORD)}`);
	} else if ("DB_FILENAME" in env) {
		if (!opts.docker.keep && existsSync(join(process.cwd(), env.DB_FILENAME))) {
			await unlink(join(process.cwd(), env.DB_FILENAME));
			logger.info(`Removed old database file at ${env.DB_FILENAME}`);
		}
		logger.info(`Database stored at ${env.DB_FILENAME} ${time}`);
	}
	return project;
}
async function dockerDown(project, env, logger) {
	const start = performance.now();
	logger.info("Stopping docker containers");
	const docker = spawn("docker", [
		"compose",
		"-p",
		project,
		"down"
	], { env: {
		...env,
		COMPOSE_STATUS_STDOUT: "1"
	} });
	docker.on("error", (err) => {
		docker.kill();
		throw err;
	});
	logger.pipe(docker.stdout, "debug");
	logger.pipe(docker.stderr, "debug");
	await new Promise((resolve$1) => docker.on("close", resolve$1));
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	logger.info(`Docker containers stopped ${time}`);
}

//#endregion
export { dockerDown, dockerUp };