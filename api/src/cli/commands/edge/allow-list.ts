import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import getDatabase, {
	isInstalled,
	validateDatabaseConnection,
} from '../../../database/index.js';
import { getExtensionManager } from '../../../extensions/index.js';
import { useLogger } from '../../../logger/index.js';
import { coreRootPaths } from '../../../core-mounts.js';
import { routerRootPaths } from '../../../utils/router-root-paths.js';
import { drainStdout } from '../../utils/drain-stdout.js';
import { railwayAllowListRuleset } from './railway.js';

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

	const malformed = [...options.include, ...options.exclude]
		.find((path) => path.startsWith('/') === false);

	if (malformed !== undefined) {
		logger.error(`A path starts with "/", got "${malformed}"`);
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

		for (const path of custom.dynamic) {
			logger.warn(
				`An extension answers on any root path (${path}); `
				+ `no prefix stands for it, so the allow-list leaves it out`,
			);
		}

		const rootPaths = [...coreRootPaths(), ...custom.paths, ...options.include]
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
