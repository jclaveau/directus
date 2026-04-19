import { RESUMABLE_UPLOADS } from "../../constants.js";
import { getStorage } from "../../storage/index.js";
import database_default from "../../database/index.js";
import emitter_default from "../../emitter.js";
import { ItemsService } from "../items.js";
import { extractMetadata } from "../files/lib/extract-metadata.js";
import "../index.js";
import { TusDataStore } from "./data-store.js";
import { getTusLocker } from "./lockers.js";
import { useEnv } from "@directus/env";
import { pick } from "lodash-es";
import { toArray as toArray$1 } from "@directus/utils";
import { supportsTus } from "@directus/storage";
import { EVENTS, Server } from "@tus/server";

//#region src/services/tus/server.ts
async function createTusStore(context) {
	const env = useEnv();
	const storage = await getStorage();
	const location = toArray$1(env["STORAGE_LOCATIONS"])[0];
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
		...RESUMABLE_UPLOADS.MAX_SIZE !== null && { maxSize: RESUMABLE_UPLOADS.MAX_SIZE },
		async onUploadFinish(req, res, upload) {
			const service = new ItemsService("directus_files", { schema: req.schema });
			const file = (await service.readByQuery({
				filter: { tus_id: { _eq: upload.id } },
				limit: 1
			}))[0];
			if (!file) return res;
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
				database: database_default(),
				schema: req.schema,
				accountability: req.accountability
			});
			return res;
		},
		generateUrl(_req, opts) {
			return env["PUBLIC_URL"] + "/files/tus/" + opts.id;
		},
		relativeLocation: String(env["PUBLIC_URL"]).startsWith("http")
	});
	server.on(EVENTS.POST_CREATE, async (_req, res, upload) => {
		res.setHeader("Directus-File-Id", upload.metadata["id"]);
	});
	return [server, cleanup];
	function cleanup() {
		server.removeAllListeners();
	}
}

//#endregion
export { createTusServer };