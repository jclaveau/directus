import express, { type Router } from 'express';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import getDatabase, {
	isInstalled,
	validateDatabaseConnection,
} from '../../../database/index.js';
import emitter from '../../../emitter.js';
import { getExtensionManager } from '../../../extensions/index.js';
import { useLogger } from '../../../logger/index.js';
import { coreRootPaths } from '../../../core-mounts.js';
import { routerRootPaths } from '../../../utils/router-root-paths.js';
import { drainStdout } from '../../utils/drain-stdout.js';
import { railwayAllowListRuleset } from './railway.js';

/** The init events `createApp` hands the app to, in the order it emits them. */
const APP_INIT_EVENTS = [
	'app.before',
	'middlewares.before',
	'middlewares.after',
	'routes.before',
	'routes.custom.before',
	'routes.custom.after',
	'routes.after',
	'app.after',
];

/**
 * What the enabled hooks mount on the app themselves, read by handing them an
 * app of their own through the init events `createApp` emits. A middleware
 * that matches its path inside its handler mounts nothing, so it stays out of
 * sight here: `--include` is for those.
 */
async function hookRootPaths(): Promise<ReturnType<typeof routerRootPaths>> {
	const app = express();

	for (const event of APP_INIT_EVENTS) {
		await emitter.emitInit(event, { app });
	}

	// Express builds the app's router on the first mount: none means no hook
	// mounted anything
	const router: Router | undefined = app._router;

	if (router === undefined) {
		return { paths: [], dynamic: [] };
	}

	return routerRootPaths(router);
}

const ROOT_PATH = /^\/[\w.~-]*$/;

export type AllowListOptions = {
	format: 'railway' | 'plain';
	blockStatus: string;
	include: string[];
	exclude: string[];
};

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
export default async function edgeAllowList(
	outPath: string | undefined,
	options: AllowListOptions,
): Promise<void> {
	const logger = useLogger();
	const blockStatus = Number(options.blockStatus);

	if (
		Number.isInteger(blockStatus) === false
		|| blockStatus < 400
		|| blockStatus > 499
	) {
		logger.error(
			`--block-status must be a 4xx status, got "${options.blockStatus}"`,
		);

		process.exit(2);
	}

	// One literal root segment, as the list holds them: `/files/tus` would
	// stand next to `/files` without narrowing it
	const malformed = [...options.include, ...options.exclude]
		.find((path) => ROOT_PATH.test(path) === false);

	if (malformed !== undefined) {
		logger.error(`A path is one root segment like "/status", got "${malformed}"`);
		process.exit(2);
	}

	const database = getDatabase();
	let written = false;

	try {
		await validateDatabaseConnection(database);

		if ((await isInstalled()) === false) {
			throw new Error(
				`Directus isn't installed on this database. `
				+ `Please run "directus bootstrap" first.`,
			);
		}

		// The enabled state of each extension is a database row, which is what the
		// database is for here
		const extensionManager = getExtensionManager();

		await extensionManager.initialize({ schedule: false, watch: false });

		const custom = routerRootPaths(extensionManager.getEndpointRouter());
		const hooked = await hookRootPaths();

		for (const path of [...custom.dynamic, ...hooked.dynamic]) {
			logger.warn(
				`An extension answers on any root path (${path}); `
				+ `no prefix stands for it, so the allow-list leaves it out`,
			);
		}

		const found = [
			...coreRootPaths(),
			...custom.paths,
			...hooked.paths,
			...options.include,
		];

		for (const path of options.exclude) {
			if (found.includes(path) === false) {
				logger.warn(`Nothing answers on ${path}; --exclude ${path} changes nothing`);
			}
		}

		const rootPaths = found
			.filter((path) => options.exclude.includes(path) === false)
			.filter((path, index, all) => all.indexOf(path) === index)
			.sort();

		let output: string;

		if (options.format === 'plain') {
			output = `${rootPaths.join('\n')}\n`;
		}
		else {
			const ruleset = railwayAllowListRuleset(rootPaths, blockStatus);

			output = `${JSON.stringify(ruleset, null, 2)}\n`;
		}

		if (outPath === undefined) {
			process.stdout.write(output);
			await drainStdout();
		}
		else {
			const filename = path.resolve(process.cwd(), outPath);

			await writeFile(filename, output);
			logger.info(`Allow-list saved to ${filename}`);
		}

		written = true;
	}
	catch (error: any) {
		logger.error(error);
	}

	database.destroy();

	if (written === false) {
		process.exit(1);
	}

	process.exit(0);
}
