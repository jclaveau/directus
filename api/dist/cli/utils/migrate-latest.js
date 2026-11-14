import { useLogger } from "../../logger/index.js";
import { outstandingMigrations } from "../../database/index.js";
import run from "../../database/migrations/run.js";
import { getSnapshotDiff } from "../../utils/get-snapshot-diff.js";
import { getSnapshot } from "../../utils/get-snapshot.js";
import { getExtensionMigrations } from "../../extensions/lib/get-extension-migrations.js";
import { applySnapshot } from "../../utils/apply-snapshot.js";
import { loadSnapshotFile } from "../commands/schema/load-snapshot.js";
import { isEmptySnapshotDiff } from "../commands/schema/report-diff.js";
import path from "node:path";

//#region src/cli/utils/migrate-latest.ts
/**
* Migrates to the latest version, the installed bundles' migrations included:
* the core's and the before-schema ones, then the snapshot, then the
* after-schema ones, which read what the snapshot creates.
*
* A `phase` runs that phase alone, for a deploy that applies its schema with its
* own tool in between.
*/
async function migrateLatest(database, snapshotPath, phase) {
	if (phase !== void 0) {
		await migrateOnePhase(database, snapshotPath, phase);
		return;
	}
	const extensionMigrations = await getExtensionMigrations();
	await run(database, "latest", true, {
		extensionMigrations,
		phase: "before-schema"
	});
	if (snapshotPath !== void 0) await applySnapshotFile(database, snapshotPath);
	else await refusePendingAfterSchema(extensionMigrations);
	await run(database, "latest", true, {
		extensionMigrations,
		phase: "after-schema"
	});
}
async function migrateOnePhase(database, snapshotPath, phase) {
	if (phase !== "before-schema" && phase !== "after-schema") throw new Error(`Unknown migration phase ${JSON.stringify(phase)}: expected "before-schema" or "after-schema"`);
	if (snapshotPath !== void 0) throw new Error(`--snapshot ${JSON.stringify(snapshotPath)} is applied between the two phases: it cannot go with --phase ${JSON.stringify(phase)}`);
	const extensionMigrations = await getExtensionMigrations();
	if (phase === "after-schema") {
		const pendingVersions = await outstandingMigrations(extensionMigrations.filter(({ config }) => config.phase !== "after-schema"));
		if (pendingVersions.length > 0) throw new Error(`Migrations ${pendingVersions.map((version) => JSON.stringify(version)).join(", ")} run before the after-schema ones: run --phase before-schema first`);
	}
	await run(database, "latest", true, {
		extensionMigrations,
		phase
	});
}
async function applySnapshotFile(database, snapshotPath) {
	const logger = useLogger();
	const snapshot = await loadSnapshotFile(path.resolve(process.cwd(), snapshotPath));
	const currentSnapshot = await getSnapshot({ database });
	const snapshotDiff = getSnapshotDiff(currentSnapshot, snapshot);
	if (isEmptySnapshotDiff(snapshotDiff)) {
		logger.info("No schema changes to apply");
		return;
	}
	await applySnapshot(snapshot, {
		current: currentSnapshot,
		diff: snapshotDiff,
		database
	});
	logger.info("Snapshot applied successfully");
}
async function refusePendingAfterSchema(extensionMigrations) {
	const afterSchemaMigrations = extensionMigrations.filter(({ config }) => config.phase === "after-schema");
	if (afterSchemaMigrations.length === 0) return;
	const pendingVersions = (await outstandingMigrations(afterSchemaMigrations)).filter((version) => {
		return afterSchemaMigrations.some(({ bundle }) => version.startsWith(`${bundle}:`));
	});
	if (pendingVersions.length === 0) return;
	throw new Error(`Migrations ${pendingVersions.map((version) => JSON.stringify(version)).join(", ")} run once the schema snapshot is applied: pass --snapshot <path>, or --phase after-schema once your own tool applied it`);
}

//#endregion
export { migrateLatest };