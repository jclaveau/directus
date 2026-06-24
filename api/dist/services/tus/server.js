import { FILE_UPLOADS, RESUMABLE_UPLOADS } from "../../constants.js";
import { getStorage } from "../../storage/index.js";
import database_default from "../../database/index.js";
import emitter_default from "../../emitter.js";
import { extractMetadata } from "../files/lib/extract-metadata.js";
import { ItemsService } from "../items.js";
import { getSchema } from "../../utils/get-schema.js";
import "../index.js";
import { TusDataStore } from "./data-store.js";
import { getTusLocker } from "./lockers.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";
import { pick } from "lodash-es";
import { supportsTus } from "@directus/storage";
import { Server } from "@tus/server";

//#region src/services/tus/server.ts
async function createTusStore(context) {
	const env = useEnv();
	const storage = await getStorage();
	const location = toArray(env["STORAGE_LOCATIONS"])[0];
	const driver = storage.location(location);
	if (!supportsTus(driver)) throw new Error(`Storage location ${location} does not support the TUS protocol`);
	return new TusDataStore({
		constants: RESUMABLE_UPLOADS,
		accountability: context.accountability,
		schema: context.schema,
		location,
		driver
	});
}
async function createTusServer(context) {
	const env = useEnv();
	const server = new Server({
		path: "/files/tus",
		datastore: await createTusStore(context),
		locker: getTusLocker(),
		...FILE_UPLOADS.MAX_SIZE !== null && { maxSize: FILE_UPLOADS.MAX_SIZE },
		async onUploadFinish(_req, upload) {
			const schema = await getSchema();
			const service = new ItemsService("directus_files", { schema });
			const file = (await service.readByQuery({
				filter: { tus_id: { _eq: upload.id } },
				limit: 1
			}))[0];
			if (!file) return {};
			let fileData;
			if (file.tus_data?.["metadata"]?.["replace_id"]) {
				const newFile = await service.readOne(file.tus_data["metadata"]["replace_id"]);
				const updateFields = pick(file, [
					"filename_download",
					"filesize",
					"type"
				]);
				const metadata = await extractMetadata(newFile.storage, {
					...newFile,
					...updateFields
				});
				await service.updateOne(file.tus_data["metadata"]["replace_id"], {
					...updateFields,
					...metadata
				});
				fileData = {
					...newFile,
					...updateFields,
					...metadata,
					id: file.tus_data["metadata"]["replace_id"]
				};
				await service.deleteOne(file.id);
			} else {
				const metadata = await extractMetadata(file.storage, file);
				await service.updateOne(file.id, {
					...metadata,
					tus_id: null,
					tus_data: null
				});
				fileData = {
					...file,
					...metadata,
					tus_id: null,
					tus_data: null
				};
			}
			emitter_default.emitAction("files.upload", {
				payload: fileData,
				key: fileData.id,
				collection: "directus_files"
			}, {
				schema,
				database: database_default(),
				accountability: context.accountability ?? null
			});
			return { headers: { "Directus-File-Id": upload.metadata["id"] } };
		},
		generateUrl(_req, opts) {
			return env["PUBLIC_URL"] + "/files/tus/" + opts.id;
		},
		allowedHeaders: env["CORS_ALLOWED_HEADERS"],
		exposedHeaders: env["CORS_EXPOSED_HEADERS"],
		relativeLocation: String(env["PUBLIC_URL"]).startsWith("http")
	});
	return [server, cleanup];
	function cleanup() {
		server.removeAllListeners();
	}
}

//#endregion
export { createTusServer };