import { useBus } from "../../../bus/lib/use-bus.js";
import "../../../bus/index.js";
import { useLogger } from "../../../logger/index.js";
import { getExtensionsPath } from "../get-extensions-path.js";
import { getStorage } from "../../../storage/index.js";
import { useLock } from "../../../lock/lib/use-lock.js";
import "../../../lock/index.js";
import { SyncStatus, isSynchronizing, setSyncStatus } from "./status.js";
import { compareFileMetadata, getSyncPaths } from "./utils.js";
import { SyncFileTracker } from "./tracker.js";
import { mkdir, rm } from "node:fs/promises";
import { useEnv } from "@directus/env";
import { normalizePath } from "@directus/utils";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import PQueue from "p-queue";
import mid from "node-machine-id";

//#region src/extensions/lib/sync/sync.ts
async function syncExtensions(options) {
	if (options?.skipSync === true) return;
	const env = useEnv();
	const lock = useLock();
	const messenger = useBus();
	const logger = useLogger();
	if (options?.forceSync !== true && await isSynchronizing()) {
		logger.debug("Extensions are already being synced to this directory from another process.");
		return;
	}
	const machineKey = `extensions-sync/${await mid.machineId()}`;
	if (await lock.increment(machineKey) !== 1) {
		logger.debug("Extensions are already being synced to this machine from another process.");
		return new Promise((resolve$1) => {
			messenger.subscribe(machineKey, () => resolve$1());
		});
	}
	try {
		logger.debug("Syncing extensions from configured storage location...");
		await mkdir(getExtensionsPath(), { recursive: true });
		await setSyncStatus(SyncStatus.SYNCING);
		const { localExtensionsPath, remoteExtensionsPath } = getSyncPaths(options?.partialSync);
		const disk = (await getStorage()).location(env["EXTENSIONS_LOCATION"]);
		if (options?.partialSync) {
			if (await disk.exists(normalizePath(join(remoteExtensionsPath, "package.json"))) === false) {
				await rm(localExtensionsPath, {
					recursive: true,
					force: true
				});
				return;
			}
		}
		const queue = new PQueue({ concurrency: 1e3 });
		const fileTracker = new SyncFileTracker();
		const hasLocalFiles = await fileTracker.readLocalFiles(localExtensionsPath) > 0;
		for await (const filepath of disk.list(remoteExtensionsPath)) {
			const relativePath = relative(resolve(sep, remoteExtensionsPath), resolve(sep, filepath));
			const destinationPath = join(localExtensionsPath, relativePath);
			await fileTracker.passedFile(relativePath);
			if (options?.forceSync !== true && hasLocalFiles) {
				if (await compareFileMetadata(destinationPath, filepath, disk)) continue;
			}
			await mkdir(dirname(destinationPath), { recursive: true });
			const readStream = await disk.read(filepath);
			const writeStream = createWriteStream(destinationPath);
			queue.add(() => pipeline(readStream, writeStream));
		}
		await queue.onIdle();
		await fileTracker.cleanup(localExtensionsPath);
	} finally {
		messenger.publish(machineKey, { ready: true });
		await lock.delete(machineKey);
		await setSyncStatus(SyncStatus.IDLE);
	}
}

//#endregion
export { syncExtensions };