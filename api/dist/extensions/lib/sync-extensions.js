import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { useLogger } from "../../logger/index.js";
import { getExtensionsPath } from "./get-extensions-path.js";
import { getStorage } from "../../storage/index.js";
import { useLock } from "../../lock/lib/use-lock.js";
import "../../lock/index.js";
import { SyncStatus, getSyncStatus, setSyncStatus } from "./sync-status.js";
import { useEnv } from "@directus/env";
import { mkdir, rm } from "node:fs/promises";
import { exists } from "fs-extra";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import Queue from "p-queue";
import mid from "node-machine-id";

//#region src/extensions/lib/sync-extensions.ts
const syncExtensions = async (options) => {
	const lock = useLock();
	const messenger = useBus();
	const env = useEnv();
	const logger = useLogger();
	if (!options?.force) {
		if (await getSyncStatus() === SyncStatus.DONE) return;
	}
	const machineKey = `extensions-sync/${await mid.machineId()}`;
	if (await lock.increment(machineKey) === 1 === false) {
		logger.trace("Extensions already being synced to this machine from another process.");
		return new Promise((resolve$1) => {
			messenger.subscribe(machineKey, () => resolve$1());
		});
	}
	try {
		const extensionsPath = getExtensionsPath();
		const storageExtensionsPath = env["EXTENSIONS_PATH"];
		if (await exists(extensionsPath)) await rm(extensionsPath, {
			recursive: true,
			force: true
		});
		await mkdir(extensionsPath, { recursive: true });
		await setSyncStatus(SyncStatus.SYNCING);
		logger.trace("Syncing extensions from configured storage location...");
		const disk = (await getStorage()).location(env["EXTENSIONS_LOCATION"]);
		const queue = new Queue({ concurrency: 1e3 });
		for await (const filepath of disk.list(storageExtensionsPath)) {
			const readStream = await disk.read(filepath);
			const destPath = join(extensionsPath, relative(resolve(sep, storageExtensionsPath), resolve(sep, filepath)));
			await mkdir(dirname(destPath), { recursive: true });
			const writeStream = createWriteStream(destPath);
			queue.add(() => pipeline(readStream, writeStream));
		}
		await queue.onIdle();
		await setSyncStatus(SyncStatus.DONE);
		messenger.publish(machineKey, { ready: true });
	} finally {
		await lock.delete(machineKey);
	}
};

//#endregion
export { syncExtensions };