import { useLogger } from "../../../logger/index.js";
import { getExtensionsPath } from "../get-extensions-path.js";
import { getStorage } from "../../../storage/index.js";
import { useEnv } from "@directus/env";
import { ServiceUnavailableError } from "@directus/errors";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "path";
import { move, remove } from "fs-extra";
import { Readable } from "node:stream";
import { download } from "@directus/extensions-registry";
import { EXTENSION_PKG_KEY, ExtensionManifest } from "@directus/extensions";
import DriverLocal from "@directus/storage-driver-local";
import Queue from "p-queue";
import { extract } from "tar";

//#region src/extensions/lib/installation/manager.ts
const env = useEnv();
var InstallationManager = class {
	extensionPath = getExtensionsPath();
	async install(versionId) {
		const logger = useLogger();
		const tempDir = join(env["TEMP_PATH"], "marketplace", versionId);
		const tmpStorage = new DriverLocal({ root: tempDir });
		try {
			await mkdir(tempDir, { recursive: true });
			const options = {};
			if (env["MARKETPLACE_REGISTRY"] && typeof env["MARKETPLACE_REGISTRY"] === "string") options.registry = env["MARKETPLACE_REGISTRY"];
			const tarReadableStream = await download(versionId, env["MARKETPLACE_TRUST"] === "sandbox", options);
			if (!tarReadableStream) throw new Error(`No readable stream returned from download`);
			const tarStream = Readable.fromWeb(tarReadableStream);
			const tarPath = join(tempDir, `bin.tar.tgz`);
			await tmpStorage.write("bin.tar.tgz", tarStream);
			/**
			* NPM modules that are packed are always tarballed in a folder called "package"
			*/
			const extractedPath = "package";
			await extract({
				file: tarPath,
				cwd: tempDir
			});
			const packageFile = JSON.parse(await readFile(join(tempDir, extractedPath, "package.json"), { encoding: "utf-8" }));
			if (!(await ExtensionManifest.parseAsync(packageFile))[EXTENSION_PKG_KEY]?.type) throw new Error(`Extension type not found in package.json`);
			if (env["EXTENSIONS_LOCATION"]) {
				const remoteDisk = (await getStorage()).location(env["EXTENSIONS_LOCATION"]);
				const queue = new Queue({ concurrency: 1e3 });
				for await (const filepath of tmpStorage.list(extractedPath)) {
					const readStream = await tmpStorage.read(filepath);
					const remotePath = join(env["EXTENSIONS_PATH"], ".registry", versionId, filepath.substring(7));
					queue.add(() => remoteDisk.write(remotePath, readStream));
				}
				await queue.onIdle();
			} else {
				const dest = join(this.extensionPath, ".registry", versionId);
				await move(join(tempDir, extractedPath), dest, { overwrite: true });
			}
		} catch (err) {
			logger.warn(err);
			throw new ServiceUnavailableError({
				service: "marketplace",
				reason: "Could not download and extract the extension"
			}, { cause: err });
		} finally {
			await rm(tempDir, { recursive: true });
		}
	}
	async uninstall(folder) {
		if (env["EXTENSIONS_LOCATION"]) {
			const remoteDisk = (await getStorage()).location(env["EXTENSIONS_LOCATION"]);
			const queue = new Queue({ concurrency: 1e3 });
			const prefix = join(env["EXTENSIONS_PATH"], ".registry", folder);
			for await (const filepath of remoteDisk.list(prefix)) queue.add(() => remoteDisk.delete(filepath));
			await queue.onIdle();
		} else await remove(join(this.extensionPath, ".registry", folder));
	}
};

//#endregion
export { InstallationManager };