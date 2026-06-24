import { useLogger } from "../logger/index.js";
import { RESUMABLE_UPLOADS } from "../constants.js";
import { getStorage } from "../storage/index.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { getAxios } from "../request/index.js";
import { transaction } from "../utils/transaction.js";
import { extractMetadata } from "./files/lib/extract-metadata.js";
import { ItemsService } from "./items.js";
import path from "path";
import { useEnv } from "@directus/env";
import { ContentTooLargeError, ForbiddenError, InternalServerError, InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import { normalizePath, toArray, toBoolean } from "@directus/utils";
import { clone, cloneDeep } from "lodash-es";
import { extension } from "mime-types";
import { PassThrough, Transform } from "node:stream";
import zlib from "node:zlib";
import url from "url";
import formatTitle from "@directus/format-title";
import encodeURL from "encodeurl";
import { minimatch } from "minimatch";

//#region src/services/files.ts
const env = useEnv();
const logger = useLogger();
var FilesService = class FilesService extends ItemsService {
	constructor(options) {
		super("directus_files", options);
	}
	/**
	* Generates the relative path for the filename_disk
	*
	* @param filenameDisk - The filepath
	*/
	generateFilenamePath(filepath) {
		return normalizePath(path.relative(path.sep, path.resolve(path.sep, filepath)));
	}
	/**
	* Check whether a filename is unique.
	*
	* @param filename - The filename
	* @param excludeId - The id of the existing file to exclude from the check
	* @throws ForbiddenError if a match is found
	*/
	async checkUniqueFilename(filename, excludeId) {
		const query = this.knex.select("filename_disk").from("directus_files").where({ filename_disk: filename });
		if (excludeId) query.whereNot("id", excludeId);
		if (await query.first()) throw new ForbiddenError();
	}
	/**
	* Upload a single new file to the configured storage adapter
	*/
	async uploadOne(stream, data, primaryKey, opts) {
		const storage = await getStorage();
		let existingFile = null;
		if (primaryKey !== void 0) existingFile = await this.knex.select("folder", "filename_download", "filename_disk", "title", "description", "metadata", "storage").from("directus_files").where({ id: primaryKey }).first() ?? null;
		const payload = {
			storage: toArray(env["STORAGE_LOCATIONS"])[0],
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
		const filenameDisk = primaryKey + (fileExtension || "");
		payload.filename_disk ||= filenameDisk;
		if (isReplacement === true && path.extname(payload.filename_disk) !== fileExtension) payload.filename_disk = filenameDisk;
		const tempFilenameDisk = "temp_" + filenameDisk;
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
			else if (err?.code && [
				"EROFS",
				"EACCES",
				"EPERM"
			].includes(err.code)) throw new InternalServerError();
			else throw new ServiceUnavailableError({
				service: "files",
				reason: `Couldn't save file ${payload.filename_disk}`
			});
		}
		if (isReplacement === true) try {
			await this.updateOne(primaryKey, payload, { emitEvents: false });
			for await (const filepath of disk.list(String(primaryKey))) await disk.delete(filepath);
			await disk.move(tempFilenameDisk, payload.filename_disk);
		} catch (err) {
			await cleanUp();
			throw err;
		}
		const { size } = await storage.location(payload.storage).stat(payload.filename_disk);
		payload.filesize = size;
		const metadata = await extractMetadata(payload.storage, payload);
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
	async importOne(importURL, body, options = {}) {
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
		const mimeType = fileResponse.headers["content-type"]?.split(";")[0]?.trim() || "application/octet-stream";
		if (toArray(env["FILES_MIME_TYPE_ALLOW_LIST"]).some((pattern) => minimatch(mimeType, pattern)) === false) throw new InvalidPayloadError({ reason: `File content type "${mimeType}" is not allowed for upload by your global file type restrictions` });
		const { filterMimeType } = options;
		if (filterMimeType && filterMimeType.length > 0) {
			if (filterMimeType.some((pattern) => minimatch(mimeType, pattern)) === false) throw new InvalidPayloadError({ reason: `File content type "${mimeType}" is not allowed for upload by this field's file type restrictions` });
		}
		const payload = {
			filename_download: filename,
			type: mimeType,
			title: formatTitle(filename),
			...body || {}
		};
		return await this.uploadOne(decompressResponse(fileResponse.data, fileResponse.headers), payload, payload.id);
	}
	/**
	* Create a file
	*/
	async createOne(data, opts = {}) {
		if (!data.type) throw new InvalidPayloadError({ reason: `"type" is required` });
		if (data.filename_disk) {
			data.filename_disk = this.generateFilenamePath(data.filename_disk);
			try {
				await this.checkUniqueFilename(data.filename_disk);
			} catch (err) {
				opts.preMutationError = err;
			}
		}
		return await super.createOne(data, opts);
	}
	/**
	* Update many files
	*/
	async updateMany(keys, data, opts = {}) {
		if (keys.length === 1 && data.filename_disk) {
			data.filename_disk = this.generateFilenamePath(data.filename_disk);
			try {
				await this.checkUniqueFilename(data.filename_disk, keys[0]);
			} catch (err) {
				opts.preMutationError = err;
			}
			const sudoFilesItemsService = new FilesService({
				knex: this.knex,
				schema: this.schema
			});
			const updatedFiles = /* @__PURE__ */ new Map();
			const changedFiles = await sudoFilesItemsService.readMany(keys, { fields: [
				"id",
				"storage",
				"filename_disk"
			] });
			for (const file of changedFiles) updatedFiles.set(file.id, file);
			for (const key of keys) await transaction(this.knex, async (trx) => {
				await new ItemsService(this.collection, {
					knex: trx,
					schema: this.schema,
					accountability: this.accountability
				}).updateMany([key], data, opts);
				if (data.filename_disk) {
					const storage = await getStorage();
					const file = updatedFiles.get(key);
					if (!file || !file.filename_disk) return;
					const existingFilePath = this.generateFilenamePath(file.filename_disk);
					if (existingFilePath === data.filename_disk) return;
					const disk = storage.location(file["storage"]);
					const { name: filePrefix, dir: fileDir } = path.parse(existingFilePath);
					const updatedFilePath = this.generateFilenamePath(data.filename_disk);
					const remoteFileExists = await disk.exists(data.filename_disk);
					const filePrefixPath = fileDir ? normalizePath(path.join(fileDir, filePrefix)) : filePrefix;
					for await (const filePath of disk.list(filePrefixPath)) {
						/**
						* If the remote file exists, repoint the primary asset to it (i.e. db update only).
						* If the remote file does not exist, move the primary asset to location.
						*
						* NOTE
						* - On repoint the original asset will be deleted if `FILES_DELETE_ORIGINAL_ON_MOVE` is true.
						* - Any associated generated assets are deleted.
						*/
						if (filePath === existingFilePath) {
							if (!remoteFileExists) {
								await disk.move(filePath, updatedFilePath);
								continue;
							} else if (toBoolean(env["FILES_DELETE_ORIGINAL_ON_MOVE"]) === false) continue;
						}
						await disk.delete(filePath);
					}
				}
			});
			return keys;
		}
		if (keys.length > 1 && data.filename_disk) opts.preMutationError = new InvalidPayloadError({ reason: "\"filename_disk\" cannot be modified in bulk operations" });
		await super.updateMany(keys, data, opts);
		return keys;
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