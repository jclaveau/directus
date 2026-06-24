import { getExtensionsPath } from "../get-extensions-path.js";
import { stat } from "node:fs/promises";
import { useEnv } from "@directus/env";
import { normalizePath } from "@directus/utils";
import { join, relative, resolve, sep } from "node:path";

//#region src/extensions/lib/sync/utils.ts
/**
* Returns the directory depth of the provided path
*/
function pathDepth(path) {
	let count = 0;
	for (let i = 0; i < path.length; i++) if (path[i] === sep) count++;
	return count;
}
/**
* Reads the size and modified date of a file if it exists
*/
async function fsStat(path) {
	const data = await stat(path, { bigint: false }).catch(() => {});
	if (!data) return null;
	return {
		size: data.size,
		modified: data.mtime
	};
}
/**
* Builds up the local and remote paths to use with syncing
*/
function getSyncPaths(partialPath) {
	const env = useEnv();
	const localRootPath = getExtensionsPath();
	const remoteRootPath = env["EXTENSIONS_PATH"];
	if (!partialPath) return {
		localExtensionsPath: localRootPath,
		remoteExtensionsPath: normalizePath(remoteRootPath)
	};
	const resolvedPartialPath = relative(sep, resolve(sep, partialPath));
	return {
		localExtensionsPath: join(localRootPath, resolvedPartialPath),
		remoteExtensionsPath: normalizePath(join(remoteRootPath, resolvedPartialPath))
	};
}
/**
* Retrieve the stats for local and remote files and check if they are the same
* Returns false if files are differnt else true
*/
async function compareFileMetadata(localPath, remotePath, disk) {
	const localStat = await fsStat(localPath).catch(() => {});
	if (!localStat) return false;
	const remoteStat = await disk.stat(remotePath).catch(() => {});
	if (!remoteStat) return false;
	return remoteStat.modified <= localStat.modified && remoteStat.size === localStat.size;
}

//#endregion
export { compareFileMetadata, fsStat, getSyncPaths, pathDepth };