import { getExtensionsPath } from "./get-extensions-path.js";
import { readFile, writeFile } from "node:fs/promises";
import { exists } from "fs-extra";
import { join } from "node:path";

//#region src/extensions/lib/sync-status.ts
let SyncStatus = /* @__PURE__ */ function(SyncStatus$1) {
	SyncStatus$1["UNKNOWN"] = "UNKNOWN";
	SyncStatus$1["SYNCING"] = "SYNCING";
	SyncStatus$1["DONE"] = "DONE";
	return SyncStatus$1;
}({});
/**
* Retrieves the sync status from the `.status` file in the local extensions folder
*/
const getSyncStatus = async () => {
	const statusFilePath = join(getExtensionsPath(), ".status");
	if (await exists(statusFilePath)) return await readFile(statusFilePath, "utf8");
	else return SyncStatus.UNKNOWN;
};
const setSyncStatus = async (status) => {
	await writeFile(join(getExtensionsPath(), ".status"), status);
};

//#endregion
export { SyncStatus, getSyncStatus, setSyncStatus };