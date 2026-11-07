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
 *
 * A `phase` runs that phase alone, for a deploy that applies its schema with its
 * own tool in between.
 */
export async function migrateLatest(
	database: Knex,
	snapshotPath?: string,
	phase?: string,
): Promise<void> {
	if (phase !== undefined) {
		await migrateOnePhase(database, snapshotPath, phase);
		return;
	}

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

async function migrateOnePhase(
	database: Knex,
	snapshotPath: string | undefined,
	phase: string,
): Promise<void> {
	if (phase !== 'before-schema' && phase !== 'after-schema') {
		throw new Error(
			`Unknown migration phase ${JSON.stringify(phase)}:`
				+ ' expected "before-schema" or "after-schema"',
		);
	}

	if (snapshotPath !== undefined) {
		throw new Error(
			`--snapshot ${JSON.stringify(snapshotPath)} is applied between the two`
				+ ` phases: it cannot go with --phase ${JSON.stringify(phase)}`,
		);
	}

	const extensionMigrations = await getExtensionMigrations();

	if (phase === 'after-schema') {
		const pendingVersions = await outstandingMigrations(
			extensionMigrations.filter(({ config }) => config.phase !== 'after-schema'),
		);

		if (pendingVersions.length > 0) {
			throw new Error(
				`Migrations ${
					pendingVersions.map((version) => JSON.stringify(version)).join(', ')
				}`
					+ ' run before the after-schema ones: run --phase before-schema first',
			);
		}
	}

	await runMigrations(database, 'latest', true, {
		extensionMigrations,
		phase,
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
			+ ' run once the schema snapshot is applied: pass --snapshot <path>,'
			+ ' or --phase after-schema once your own tool applied it',
	);
}
