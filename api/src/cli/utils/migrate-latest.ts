import type { Knex } from 'knex';
import path from 'node:path';
import { outstandingMigrations } from '../../database/index.js';
import type { ExtensionMigration } from '../../database/migrations/list.js';
import runMigrations from '../../database/migrations/run.js';
import {
	getExtensionMigrations,
} from '../../extensions/lib/get-extension-migrations.js';
import { useLogger } from '../../logger/index.js';
import { applySnapshot } from '../../utils/apply-snapshot.js';
import { getSnapshotDiff } from '../../utils/get-snapshot-diff.js';
import { getSnapshot } from '../../utils/get-snapshot.js';
import { loadSnapshotFile } from '../commands/schema/load-snapshot.js';
import { isEmptySnapshotDiff } from '../commands/schema/report-diff.js';

/**
 * Migrates to the latest version, the installed bundles' migrations included:
 * the core's and the before-schema ones, then the snapshot, then the
 * after-schema ones, which read what the snapshot creates.
 */
export async function migrateLatest(
	database: Knex,
	snapshotPath?: string,
): Promise<void> {
	const extensionMigrations = await getExtensionMigrations();

	await runMigrations(database, 'latest', true, {
		extensionMigrations,
		phase: 'before-schema',
	});

	if (snapshotPath !== undefined) {
		await applySnapshotFile(database, snapshotPath);
	}
	else {
		await refusePendingAfterSchema(extensionMigrations);
	}

	await runMigrations(database, 'latest', true, {
		extensionMigrations,
		phase: 'after-schema',
	});
}

async function applySnapshotFile(
	database: Knex,
	snapshotPath: string,
): Promise<void> {
	const logger = useLogger();

	const snapshot = await loadSnapshotFile(path.resolve(process.cwd(), snapshotPath));
	const currentSnapshot = await getSnapshot({ database });
	const snapshotDiff = getSnapshotDiff(currentSnapshot, snapshot);

	if (isEmptySnapshotDiff(snapshotDiff)) {
		logger.info('No schema changes to apply');
		return;
	}

	await applySnapshot(snapshot, {
		current: currentSnapshot,
		diff: snapshotDiff,
		database,
	});

	logger.info('Snapshot applied successfully');
}

async function refusePendingAfterSchema(
	extensionMigrations: ExtensionMigration[],
): Promise<void> {
	const afterSchemaMigrations = extensionMigrations.filter(
		({ config }) => config.phase === 'after-schema',
	);

	if (afterSchemaMigrations.length === 0) {
		return;
	}

	const outstanding = await outstandingMigrations(afterSchemaMigrations);

	const pendingVersions = outstanding.filter(
		(version) => {
			return afterSchemaMigrations.some(
				({ bundle }) => version.startsWith(`${bundle}:`),
			);
		},
	);

	if (pendingVersions.length === 0) {
		return;
	}

	throw new Error(
		`Migrations ${
			pendingVersions.map((version) => JSON.stringify(version)).join(', ')
		}`
			+ ' run once the schema snapshot is applied: pass --snapshot <path>',
	);
}
