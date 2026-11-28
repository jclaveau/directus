import database_default, { isInstalled, validateDatabaseConnection } from "../../../database/index.js";
import { getSnapshotDiff } from "../../../utils/get-snapshot-diff.js";
import { getSnapshot } from "../../../utils/get-snapshot.js";
import { validateSnapshot } from "../../../utils/validate-snapshot.js";
import { drainStdout } from "../../utils/drain-stdout.js";
import { loadSnapshotFile } from "./load-snapshot.js";
import { filterSnapshotDiff, formatSnapshotDiff, isEmptySnapshotDiff } from "./report-diff.js";
import path from "node:path";

//#region src/cli/commands/schema/diff.ts
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
*
* The report goes to the console rather than the logger: the exit code is the
* contract, and what explains it must not depend on LOG_LEVEL.
*/
async function schemaDiff(snapshotPath, options) {
	const database = database_default();
	let report;
	try {
		await validateDatabaseConnection(database);
		if (await isInstalled() === false) throw new Error("Directus isn't installed on this database. Please run \"directus bootstrap\" first.");
		const snapshot = await loadSnapshotFile(path.resolve(process.cwd(), snapshotPath));
		validateSnapshot(snapshot, true);
		let snapshotDiff = getSnapshotDiff(await getSnapshot({ database }), snapshot);
		if (options?.ignoreRules) {
			const ignored = options.ignoreRules.split(",");
			snapshotDiff = filterSnapshotDiff(snapshotDiff, ignored);
		}
		report = isEmptySnapshotDiff(snapshotDiff) ? "" : formatSnapshotDiff(snapshotDiff);
	} catch (error) {
		console.error(error);
	}
	database.destroy();
	if (report === void 0) await exitWhenLogged(2);
	else if (report === "") {
		if (!options?.quiet) console.log("Schema matches the snapshot");
		await exitWhenLogged(0);
	} else {
		if (!options?.quiet) console.log(`Schema differs from the snapshot:\n\n${report}`);
		await exitWhenLogged(1);
	}
}
async function exitWhenLogged(code) {
	await drainStdout();
	process.exit(code);
}

//#endregion
export { schemaDiff as default };