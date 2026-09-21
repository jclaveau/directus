import type { Snapshot } from '@directus/types';
import inquirer from 'inquirer';
import path from 'path';
import getDatabase, { isInstalled, validateDatabaseConnection } from '../../../database/index.js';
import { useLogger } from '../../../logger/index.js';
import { applySnapshot } from '../../../utils/apply-snapshot.js';
import { getSnapshotDiff } from '../../../utils/get-snapshot-diff.js';
import { getSnapshot } from '../../../utils/get-snapshot.js';
import { loadSnapshotFile } from './load-snapshot.js';
import {
	filterSnapshotDiff,
	formatSnapshotDiff,
	isEmptySnapshotDiff,
} from './report-diff.js';

export async function apply(
	snapshotPath: string,
	options?: { yes: boolean; dryRun: boolean; ignoreRules: string },
): Promise<void> {
	const logger = useLogger();

	const filename = path.resolve(process.cwd(), snapshotPath);

	const database = getDatabase();

	await validateDatabaseConnection(database);

	if ((await isInstalled()) === false) {
		logger.error(`Directus isn't installed on this database. Please run "directus bootstrap" first.`);
		database.destroy();
		process.exit(0);
	}

	let snapshot: Snapshot;

	try {
		snapshot = await loadSnapshotFile(filename);

		const currentSnapshot = await getSnapshot({ database });
		let snapshotDiff = getSnapshotDiff(currentSnapshot, snapshot);

		if (options?.ignoreRules) {
			snapshotDiff = filterSnapshotDiff(snapshotDiff, options.ignoreRules.split(','));
		}

		if (isEmptySnapshotDiff(snapshotDiff)) {
			logger.info('No changes to apply.');
			database.destroy();
			process.exit(0);
		}

		const dryRun = options?.dryRun === true;
		const promptForChanges = !dryRun && options?.yes !== true;

		if (dryRun || promptForChanges) {
			const listing = formatSnapshotDiff(snapshotDiff);
			const message = `The following changes will be applied:\n\n${listing}`;

			if (dryRun) {
				// eslint-disable-next-line no-console
				console.log(message);
				process.exit(0);
			}

			const { proceed } = await inquirer.prompt([
				{
					type: 'confirm',
					name: 'proceed',
					message: message + '\n\n' + 'Would you like to continue?',
				},
			]);

			if (proceed === false) {
				process.exit(0);
			}
		}

		await applySnapshot(snapshot, { current: currentSnapshot, diff: snapshotDiff, database });

		logger.info(`Snapshot applied successfully`);

		database.destroy();
		process.exit(0);
	} catch (err: any) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}
