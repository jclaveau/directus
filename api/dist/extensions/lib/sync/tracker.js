import { pathDepth } from "./utils.js";
import { readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

//#region src/extensions/lib/sync/tracker.ts
var SyncFileTracker = class {
	localFiles;
	trackedDirs;
	constructor() {
		this.localFiles = /* @__PURE__ */ new Set();
		this.trackedDirs = /* @__PURE__ */ new Set();
	}
	/**
	* Reads all files recusrively in the provided directory
	* @returns the number of files read
	*/
	async readLocalFiles(localExtensionsPath) {
		const entries = await readdir(localExtensionsPath, {
			recursive: true,
			withFileTypes: true
		}).catch(() => {});
		if (!entries) return 0;
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const relativePath = join(relative(localExtensionsPath, entry.parentPath), entry.name);
			this.localFiles.add(relativePath);
		}
		return this.localFiles.size;
	}
	/**
	* Removes a file from the locally tracked files
	*/
	async passedFile(filePath) {
		this.localFiles.delete(filePath);
		let currentDir = dirname(filePath);
		while (currentDir !== ".") {
			if (this.trackedDirs.has(currentDir)) break;
			this.trackedDirs.add(currentDir);
			currentDir = dirname(currentDir);
		}
	}
	/**
	* Removes left over tracked files that were not processed
	*/
	async cleanup(localExtensionsPath) {
		const removeDirs = /* @__PURE__ */ new Set();
		for (const removeFile of this.localFiles) {
			if (removeFile === ".status") continue;
			let currentDir = dirname(removeFile);
			while (currentDir !== localExtensionsPath && currentDir !== ".") {
				if (this.trackedDirs.has(currentDir)) break;
				removeDirs.add(currentDir);
				currentDir = dirname(currentDir);
			}
		}
		const removeDirsRecursive = Array.from(removeDirs).sort((a, b) => pathDepth(b) - pathDepth(a)).filter((d) => !removeDirs.has(dirname(d)));
		for (const dir of removeDirsRecursive) await rm(join(localExtensionsPath, dir), {
			recursive: true,
			force: true
		});
	}
};

//#endregion
export { SyncFileTracker };