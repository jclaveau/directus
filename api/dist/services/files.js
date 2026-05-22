import { RESUMABLE_UPLOADS } from "../constants.js";
import { useLogger } from "../logger/index.js";
import { getStorage } from "../storage/index.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { ItemsService } from "./items.js";
import { getAxios } from "../request/index.js";
import { extractMetadata } from "./files/lib/extract-metadata.js";
import { useEnv } from "@directus/env";
import { ContentTooLargeError, InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import { clone, cloneDeep } from "lodash-es";
import path from "path";
import { toArray as toArray$1 } from "@directus/utils";
import { PassThrough, Transform } from "node:stream";
import { extension } from "mime-types";
import formatTitle from "@directus/format-title";
import encodeURL from "encodeurl";
import zlib from "node:zlib";
import url from "url";

//#region src/services/files.ts
const env = useEnv();
const logger = useLogger();
var FilesService = class FilesService extends ItemsService {
	constructor(options) {
		super("directus_files", options);
	}
	/**
	* Upload a single new file to the configured storage adapter
	*/
	async uploadOne(stream, data, primaryKey, opts) {
		const storage = await getStorage();
		let existingFile = null;
		if (primaryKey !== void 0) existingFile = await this.knex.select("folder", "filename_download", "filename_disk", "title", "description", "metadata").from("directus_files").where({ id: primaryKey }).first() ?? null;
		const payload = {
			...existingFile ?? {},
			...clone(data)
		};
		const disk = storage.location(payload.storage);
		if ("folder" in payload === false) {
			const settings = await this.knex.select("storage_default_folder").from("directus_settings").first();
			if (settings?.storage_default_folder) payload.folder = settings.storage_default_folder;
		}
		const isReplacement = existingFile !== null && primaryKey !== void 0;
		if (isReplacement === false || primaryKey === void 0) primaryKey = await this.createOne(payload, { emitEvents: false });
		const fileExtension = path.extname(payload.filename_download) || payload.type && "." + extension(payload.type) || "";
		payload.filename_disk ||= primaryKey + (fileExtension || "");
		if (isReplacement === true && path.extname(payload.filename_disk) !== fileExtension) payload.filename_disk = primaryKey + (fileExtension || "");
		const tempFilenameDisk = "temp_" + payload.filename_disk;
		if (!payload.type) payload.type = "application/octet-stream";
		const cleanUp = async () => {
			try {
				if (isReplacement === true) await disk.delete(tempFilenameDisk);
				else {
					await super.deleteMany([primaryKey]);
					await disk.delete(payload.filename_disk);
				}
			} catch (err) {
				if (isReplacement === true) logger.warn(`Couldn't delete temp file ${tempFilenameDisk}`);
				else logger.warn(`Couldn't delete file ${payload.filename_disk}`);
				logger.warn(err);
			}
		};
		try {
			if (isReplacement === true) await disk.write(tempFilenameDisk, stream, payload.type);
			else await disk.write(payload.filename_disk, stream, payload.type);
			if ("truncated" in stream && stream.truncated === true) throw new ContentTooLargeError();
		} catch (err) {
			logger.warn(`Couldn't save file ${payload.filename_disk}`);
			logger.warn(err);
			await cleanUp();
			if (err instanceof ContentTooLargeError) throw err;
			else throw new ServiceUnavailableError({
				service: "files",
				reason: `Couldn't save file ${payload.filename_disk}`
			});
		}
		if (isReplacement === true) {
			await this.updateOne(primaryKey, payload, { emitEvents: false });
			for await (const filepath of disk.list(String(primaryKey))) await disk.delete(filepath);
			await disk.move(tempFilenameDisk, payload.filename_disk);
		}
		const { size } = await storage.location(data.storage).stat(payload.filename_disk);
		payload.filesize = size;
		const metadata = await extractMetadata(data.storage, payload);
		payload.uploaded_on = (/* @__PURE__ */ new Date()).toISOString();
		await new ItemsService("directus_files", {
			knex: this.knex,
			schema: this.schema
		}).updateOne(primaryKey, {
			...payload,
			...metadata
		}, { emitEvents: false });
		if (opts?.emitEvents !== false) emitter_default.emitAction("files.upload", {
			payload,
			key: primaryKey,
			collection: this.collection
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
		return primaryKey;
	}
	/**
	* Extract metadata from a buffer's content
	*/
	/**
	* Import a single file from an external URL
	*/
	async importOne(importURL, body) {
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "create",
			collection: "directus_files"
		}, {
			knex: this.knex,
			schema: this.schema
		});
		let fileResponse;
		try {
			fileResponse = await (await getAxios()).get(encodeURL(importURL), {
				responseType: "stream",
				decompress: false
			});
		} catch (error) {
			logger.warn(`Couldn't fetch file from URL "${importURL}"${error.message ? `: ${error.message}` : ""}`);
			logger.trace(error);
			throw new ServiceUnavailableError({
				service: "external-file",
				reason: `Couldn't fetch file from URL "${importURL}"`
			});
		}
		const parsedURL = url.parse(fileResponse.request.res.responseUrl);
		const filename = decodeURI(path.basename(parsedURL.pathname));
		const payload = {
			filename_download: filename,
			storage: toArray$1(env["STORAGE_LOCATIONS"])[0],
			type: fileResponse.headers["content-type"],
			title: formatTitle(filename),
			...body || {}
		};
		return await this.uploadOne(decompressResponse(fileResponse.data, fileResponse.headers), payload, payload.id);
	}
	/**
	* Create a file (only applicable when it is not a multipart/data POST request)
	* Useful for associating metadata with existing file in storage
	*/
	async createOne(data, opts) {
		if (!data.type) throw new InvalidPayloadError({ reason: `"type" is required` });
		return await super.createOne(data, opts);
	}
	/**
	* Delete multiple files
	*/
	async deleteMany(keys) {
		const storage = await getStorage();
		const files = await new FilesService({
			knex: this.knex,
			schema: this.schema
		}).readMany(keys, {
			fields: [
				"id",
				"storage",
				"filename_disk"
			],
			limit: -1
		});
		await super.deleteMany(keys);
		for (const file of files) {
			const disk = storage.location(file["storage"]);
			const filePrefix = path.parse(file["filename_disk"]).name;
			for await (const filepath of disk.list(filePrefix)) await disk.delete(filepath);
		}
		return keys;
	}
	async readByQuery(query, opts) {
		const filteredQuery = cloneDeep(query);
		if (RESUMABLE_UPLOADS.ENABLED === true) {
			const filterPartialUploads = { tus_id: { _null: true } };
			if (!filteredQuery.filter) filteredQuery.filter = filterPartialUploads;
			else if ("_and" in filteredQuery.filter && Array.isArray(filteredQuery.filter["_and"])) filteredQuery.filter["_and"].push(filterPartialUploads);
			else filteredQuery.filter = { _and: [filteredQuery.filter, filterPartialUploads] };
		}
		return super.readByQuery(filteredQuery, opts);
	}
};
function decompressResponse(stream, headers) {
	const contentEncoding = (headers["content-encoding"] || "").toLowerCase();
	if (![
		"gzip",
		"deflate",
		"br"
	].includes(contentEncoding)) return stream;
	let isEmpty$1 = true;
	const checker = new Transform({
		transform(data, _encoding, callback) {
			if (isEmpty$1 === false) {
				callback(null, data);
				return;
			}
			isEmpty$1 = false;
			handleContentEncoding(data);
			callback(null, data);
		},
		flush(callback) {
			callback();
		}
	});
	const finalStream = new PassThrough({
		autoDestroy: false,
		destroy(error, callback) {
			stream.destroy();
			callback(error);
		}
	});
	stream.pipe(checker);
	return finalStream;
	function handleContentEncoding(data) {
		let decompressStream;
		if (contentEncoding === "br") decompressStream = zlib.createBrotliDecompress();
		else if (contentEncoding === "deflate" && isDeflateAlgorithm(data)) decompressStream = zlib.createInflateRaw();
		else decompressStream = zlib.createUnzip();
		decompressStream.once("error", (error) => {
			if (isEmpty$1 && !stream.readable) {
				finalStream.end();
				return;
			}
			finalStream.destroy(error);
		});
		checker.pipe(decompressStream).pipe(finalStream);
	}
	function isDeflateAlgorithm(data) {
		return data.length > 0 && (data[0] & 8) === 0;
	}
}

//#endregion
export { FilesService };