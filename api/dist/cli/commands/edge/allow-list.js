import { useLogger } from "../../../logger/index.js";
import database_default, { isInstalled, validateDatabaseConnection } from "../../../database/index.js";
import emitter_default from "../../../emitter.js";
import { getExtensionManager } from "../../../extensions/index.js";
import { routerRootPaths } from "../../../utils/router-root-paths.js";
import { coreRootPaths } from "../../../core-mounts.js";
import { drainStdout } from "../../utils/drain-stdout.js";
import { railwayAllowListRuleset } from "./railway.js";
import express from "express";
import { writeFile } from "node:fs/promises";
import path from "node:path";

//#region src/cli/commands/edge/allow-list.ts
/** The init events `createApp` hands the app to, in the order it emits them. */
const APP_INIT_EVENTS = [
	"app.before",
	"middlewares.before",
	"middlewares.after",
	"routes.before",
	"routes.custom.before",
	"routes.custom.after",
	"routes.after",
	"app.after"
];
/**
* What the enabled hooks mount on the app themselves, read by handing them an
* app of their own through the init events `createApp` emits. A middleware
* that matches its path inside its handler mounts nothing, so it stays out of
* sight here: `--include` is for those.
*/
async function hookRootPaths() {
	const app = express();
	for (const event of APP_INIT_EVENTS) await emitter_default.emitInit(event, { app });
	const router = app._router;
	if (router === void 0) return {
		paths: [],
		dynamic: []
	};
	return routerRootPaths(router);
}
const ROOT_PATH = /^\/[\w.~-]*$/;
/**
* Print the root paths this deployment answers on, as the allow-list an edge in
* front of it can enforce: the core API's mounts as its environment turns them
* on, plus every endpoint the enabled extensions register.
*
* Read from the deployment rather than written by hand so the list follows the
* code: a mount added, an extension enabled or an env flag flipped changes what
* this prints, and a ruleset regenerated from it lets the new path through
* instead of blocking it at the edge, where the API never sees the request.
*
* To a file when a path is given: the logs share stdout, and a warning the load
* writes there would land inside a piped ruleset.
*
* Exits 1 when the paths could not be read or written, 2 when an option is
* invalid.
*/
async function edgeAllowList(outPath, options) {
	const logger = useLogger();
	const blockStatus = Number(options.blockStatus);
	if (Number.isInteger(blockStatus) === false || blockStatus < 400 || blockStatus > 499) {
		logger.error(`--block-status must be a 4xx status, got "${options.blockStatus}"`);
		process.exit(2);
	}
	const malformed = [...options.include, ...options.exclude].find((path$1) => ROOT_PATH.test(path$1) === false);
	if (malformed !== void 0) {
		logger.error(`A path is one root segment like "/status", got "${malformed}"`);
		process.exit(2);
	}
	const database = database_default();
	let written = false;
	try {
		await validateDatabaseConnection(database);
		if (await isInstalled() === false) throw new Error("Directus isn't installed on this database. Please run \"directus bootstrap\" first.");
		const extensionManager = getExtensionManager();
		await extensionManager.initialize({
			schedule: false,
			watch: false
		});
		const custom = routerRootPaths(extensionManager.getEndpointRouter());
		const hooked = await hookRootPaths();
		for (const path$1 of [...custom.dynamic, ...hooked.dynamic]) logger.warn(`An extension answers on any root path (${path$1}); no prefix stands for it, so the allow-list leaves it out`);
		const found = [
			...coreRootPaths(),
			...custom.paths,
			...hooked.paths,
			...options.include
		];
		for (const path$1 of options.exclude) if (found.includes(path$1) === false) logger.warn(`Nothing answers on ${path$1}; --exclude ${path$1} changes nothing`);
		const rootPaths = found.filter((path$1) => options.exclude.includes(path$1) === false).filter((path$1, index, all) => all.indexOf(path$1) === index).sort();
		let output;
		if (options.format === "plain") output = `${rootPaths.join("\n")}\n`;
		else {
			const ruleset = railwayAllowListRuleset(rootPaths, blockStatus);
			output = `${JSON.stringify(ruleset, null, 2)}\n`;
		}
		if (outPath === void 0) {
			process.stdout.write(output);
			await drainStdout();
		} else {
			const filename = path.resolve(process.cwd(), outPath);
			await writeFile(filename, output);
			logger.info(`Allow-list saved to ${filename}`);
		}
		written = true;
	} catch (error) {
		logger.error(error);
	}
	database.destroy();
	if (written === false) process.exit(1);
	process.exit(0);
}

//#endregion
export { edgeAllowList as default };