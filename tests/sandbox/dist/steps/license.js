import { licenseFolder } from "../sandbox.js";
import { spawn } from "child_process";
import { join } from "path";
import chalk from "chalk";

//#region src/steps/license.ts
async function startLicenseServer(env, logger) {
	const start = performance.now();
	logger.info("Starting license server");
	const license = spawn("node", [join(licenseFolder, "dist", "run.js")], { env });
	license.on("error", (err) => {
		license.kill();
		throw err;
	});
	logger.pipe(license.stderr, "debug");
	await new Promise((resolve$1) => {
		license.stdout.on("data", (data) => {
			const msg = String(data);
			if (msg.includes(`Server listening at http://127.0.0.1:${env.LICENSE_PORT}`)) resolve$1(void 0);
			else logger.debug(msg);
		});
	});
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	logger.info(`License server started at http://localhost:${env.LICENSE_PORT} ${time}`);
	return license;
}

//#endregion
export { startLicenseServer };