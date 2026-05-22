import { flushCaches } from "../cache.js";
import database_default from "../database/index.js";
import { getSchema } from "./get-schema.js";
import { applyDiff } from "./apply-diff.js";
import { getSnapshotDiff } from "./get-snapshot-diff.js";
import { getSnapshot } from "./get-snapshot.js";

//#region src/utils/apply-snapshot.ts
async function applySnapshot(snapshot, options) {
	const database = options?.database ?? database_default();
	const schema = options?.schema ?? await getSchema({
		database,
		bypassCache: true
	});
	const current = options?.current ?? await getSnapshot({
		database,
		schema
	});
	await applyDiff(current, options?.diff ?? getSnapshotDiff(current, snapshot), {
		database,
		schema
	});
	await flushCaches();
}

//#endregion
export { applySnapshot };