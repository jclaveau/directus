import { getExtensionsPath } from "../get-extensions-path.js";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "fs-extra";

//#region src/extensions/lib/sync/status.ts
const SyncStatus = {
	SYNCING: "SYNCING",
	IDLE: "IDLE"
};
async function getSyncStatus() {
	if (await exists(join(getExtensionsPath(), ".status"))) return SyncStatus.SYNCING;
	return SyncStatus.IDLE;
}
async function setSyncStatus(status) {
	const statusFilePath = join(getExtensionsPath(), ".status");
	if (status === SyncStatus.SYNCING) await writeFile(statusFilePath, "");
	else await rm(statusFilePath);
}
/**
* Checks the filesystem lock file if we are currently synchronizing
*/
async function isSynchronizing() {
	return await getSyncStatus() === SyncStatus.SYNCING;
}

//#endregion
export { SyncStatus, getSyncStatus, isSynchronizing, setSyncStatus };