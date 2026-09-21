import path from 'path';
import getDatabase, {
	isInstalled,
	validateDatabaseConnection,
} from '../../../database/index.js';
import { useLogger } from '../../../logger/index.js';
import { getSnapshotDiff } from '../../../utils/get-snapshot-diff.js';
import { getSnapshot } from '../../../utils/get-snapshot.js';
import { drainStdout } from '../../utils/drain-stdout.js';
import { loadSnapshotFile } from './load-snapshot.js';
import {
	filterSnapshotDiff,
	formatSnapshotDiff,
	isEmptySnapshotDiff,
} from './report-diff.js';

/**
 * Say whether the database matches a snapshot, as an exit code a deploy step or
 * a CI job can gate on: 0 when it does, 1 when it differs, 2 when the comparison
 * could not be made.
 *
 * `schema apply` reads the same diff, but a tool importing a snapshot decides on
 * its own whether there is anything to apply — directus-extension-schema-sync
 * skips the diff when the database's hash equals the one recorded at export, so
 * a collection file edited by hand never reaches it and nothing says so. This is
 * the read of the database that tells.
 */
export default async function schemaDiff(
	snapshotPath: string,
	options?: { quiet?: boolean; ignoreRules?: string },
): Promise<void> {
	const logger = useLogger();
	const database = getDatabase();
	let report: string | undefined;

	try {
		await validateDatabaseConnection(database);

		if ((await isInstalled()) === false) {
			throw new Error(
				`Directus isn't installed on this database. `
				+ `Please run "directus bootstrap" first.`,
			);
		}

		const filename = path.resolve(process.cwd(), snapshotPath);
		const snapshot = await loadSnapshotFile(filename);
		const currentSnapshot = await getSnapshot({ database });
		let snapshotDiff = getSnapshotDiff(currentSnapshot, snapshot);

		if (options?.ignoreRules) {
			const ignored = options.ignoreRules.split(',');

			snapshotDiff = filterSnapshotDiff(snapshotDiff, ignored);
		}

		report = isEmptySnapshotDiff(snapshotDiff)
			? ''
			: formatSnapshotDiff(snapshotDiff);
	}
	catch (error: any) {
		logger.error(error);
	}

	database.destroy();

	// One branch, one exit: `process.exit` does not stop the caller while an `exit`
	// listener runs
	if (report === undefined) {
		await exitWhenLogged(2);
	}
	else if (report === '') {
		if (!options?.quiet) {
			logger.info('Schema matches the snapshot');
		}

		await exitWhenLogged(0);
	}
	else {
		if (!options?.quiet) {
			// eslint-disable-next-line no-console
			console.log(`Schema differs from the snapshot:\n\n${report}`);
		}

		await exitWhenLogged(1);
	}
}

// The outcome line is the last thing written and the first thing an immediate
// exit loses from a piped stdout
async function exitWhenLogged(code: number): Promise<void> {
	await drainStdout();
	process.exit(code);
}
