import { RESUMABLE_UPLOADS } from "../constants.js";
import { clone, cloneDeep, escapeRegExp } from "../utils/lodash-es-used.js";
import { useLogger } from "../logger/index.js";
import { getStorage } from "../storage/index.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { ItemsService } from "./items.js";
import { getAxios } from "../request/index.js";
import { unnormalisedDiskNameReason } from "./files/lib/disk-name.js";
import { extractMetadata } from "./files/lib/extract-metadata.js";
import { useEnv } from "@directus/env";
import { ContentTooLargeError, ErrorCode, InvalidPayloadError, ServiceUnavailableError, isDirectusError } from "@directus/errors";
import path from "node:path";
import { toArray } from "@directus/utils";
import url from "node:url";
import { PassThrough, Transform } from "node:stream";
import { extension } from "mime-types";
import formatTitle from "@directus/format-title";
import encodeURL from "encodeurl";
import zlib from "node:zlib";

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
		if (payload.filename_disk === "") delete payload.filename_disk;
		const disk = storage.location(payload.storage);
		const requestedDiskName = data.filename_disk;
		if (requestedDiskName) refuseUnnormalisedDiskName(requestedDiskName);
		if (requestedDiskName && requestedDiskName !== existingFile?.["filename_disk"] && await disk.exists(requestedDiskName)) throw new InvalidPayloadError({ reason: diskNameTakenReason(requestedDiskName) });
		const fileExtension = path.extname(payload.filename_download) || payload.type && `.${extension(payload.type)}` || "";
		if (existingFile === null && payload.id && !payload.filename_disk) {
			const derivedDiskName = `${payload.id}${fileExtension}`;
			const holderRow = await this.knex.select("id").from("directus_files").where({ filename_disk: derivedDiskName }).first();
			if (holderRow ? String(holderRow.id) !== String(payload.id) : await disk.exists(derivedDiskName)) throw new InvalidPayloadError({ reason: diskNameTakenReason(derivedDiskName) });
		}
		if ("folder" in payload === false) {
			const settings = await this.knex.select("storage_default_folder").from("directus_settings").first();
			if (settings?.storage_default_folder) payload.folder = settings.storage_default_folder;
		}
		const isReplacement = existingFile !== null && primaryKey !== void 0;
		if (isReplacement === false || primaryKey === void 0) primaryKey = await this.createOne(payload, { emitEvents: false });
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
			else throw new ServiceUnavailableError({
				service: "files",
				reason: `Couldn't save file ${payload.filename_disk}`
			});
		}
		if (isReplacement === true) try {
			await this.updateOne(primaryKey, payload, { emitEvents: false });
			if (existingFile?.["filename_disk"]) await deleteFileAndThumbnails(disk, existingFile["filename_disk"]);
			await disk.move(tempFilenameDisk, payload.filename_disk);
		} catch (err) {
			await cleanUp();
			throw err;
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
			storage: toArray(env["STORAGE_LOCATIONS"])[0],
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
	async createMany(data, opts = {}) {
		for (const item of data) if (!item.type) throw new InvalidPayloadError({ reason: `"type" is required` });
		try {
			return await super.createMany(data, opts);
		} catch (error) {
			throw diskNameTakenErrorFrom(error);
		}
	}
	async updateGroups(groups, opts = {}) {
		try {
			return await super.updateGroups(groups, opts);
		} catch (error) {
			throw diskNameTakenErrorFrom(error);
		}
	}
	async validateRowsToCreate(rows, trx) {
		await this.refuseUnusableDiskNames(rows.map((row) => ({
			filenameDisk: row.filename_disk,
			ownerKey: null
		})), trx);
	}
	async validateGroupsToUpdate(groups, trx) {
		const claimsByKeyName = /* @__PURE__ */ new Map();
		for (const group of groups) {
			if (!("filename_disk" in group.data)) continue;
			const groupKeyNames = new Set(group.keys.map((ownerKey) => {
				return this.primaryKeyNameOf(ownerKey);
			}));
			for (const keyName of groupKeyNames) if (claimsByKeyName.has(keyName)) throw new InvalidPayloadError({ reason: `Row ${keyName} is sent more than once; send each row once` });
			for (const ownerKey of group.keys) claimsByKeyName.set(this.primaryKeyNameOf(ownerKey), {
				filenameDisk: group.data.filename_disk,
				ownerKey
			});
		}
		await this.refuseUnusableDiskNames([...claimsByKeyName.values()], trx);
	}
	/**
	* Refuse a `filename_disk` that is not a normalised relative path, that
	* another row holds, or that two claims share.
	*
	* - Deleting either row would delete the other's file, and reading the asset
	*   would serve the other's content.
	* - A name only the disk holds is accepted: a row can be created for a file
	*   already in storage.
	* - A name the batch moves its holder off is free, as in translations. The
	*   unique index still judges each write in order, so the batch must move
	*   the holder before the row taking its name; a swap is refused.
	*/
	async refuseUnusableDiskNames(diskNameClaims, trx) {
		const claimedNames = diskNameClaims.flatMap((claim) => {
			if (claim.filenameDisk === null || claim.filenameDisk === void 0) return [];
			return [claim.filenameDisk];
		});
		for (const claimedName of claimedNames) refuseUnnormalisedDiskName(claimedName);
		const sharedName = claimedNames.find((name, index) => {
			return claimedNames.indexOf(name) !== index;
		});
		if (sharedName) throw new InvalidPayloadError({ reason: diskNameTakenReason(sharedName) });
		if (claimedNames.length === 0) return;
		const holderRows = await trx.select("id", "filename_disk").from("directus_files").whereIn("filename_disk", claimedNames);
		for (const holderRow of holderRows) {
			if (diskNameClaims.some((claim) => {
				return claim.ownerKey !== null && claim.filenameDisk !== holderRow.filename_disk && this.primaryKeyNameOf(claim.ownerKey) === this.primaryKeyNameOf(holderRow.id);
			})) continue;
			if (diskNameClaims.some((claim) => {
				if (claim.filenameDisk !== holderRow.filename_disk) return false;
				return claim.ownerKey === null || this.primaryKeyNameOf(claim.ownerKey) !== this.primaryKeyNameOf(holderRow.id);
			})) throw new InvalidPayloadError({ reason: diskNameTakenReason(holderRow.filename_disk) });
		}
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
		for (const file of files) await deleteFileAndThumbnails(storage.location(file["storage"]), file["filename_disk"]);
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
function diskNameTakenReason(filenameDisk) {
	return `"filename_disk" "${filenameDisk}" is already used by another file`;
}
/**
* The guard's 400 for a disk name the unique index refused: a row that took
* the name after the guard read the table. A batch insert cannot tell which
* row the database refused, so the reason may name no disk name.
*/
function diskNameTakenErrorFrom(error) {
	if (!isDirectusError(error, ErrorCode.RecordNotUnique)) return error;
	if (error.extensions.collection !== "directus_files" || error.extensions.field !== "filename_disk") return error;
	const takenName = error.extensions.value;
	if (!takenName) return new InvalidPayloadError({ reason: "\"filename_disk\" is already used by another file" });
	return new InvalidPayloadError({ reason: diskNameTakenReason(takenName) });
}
function refuseUnnormalisedDiskName(filenameDisk) {
	const unnormalisedReason = unnormalisedDiskNameReason(filenameDisk);
	if (unnormalisedReason) throw new InvalidPayloadError({ reason: unnormalisedReason });
}
/**
* Delete a stored file and the thumbnails the assets service made from it.
*
* - A thumbnail is `<name>__<sha1 of the transforms>.<ext>` at the storage
*   root, whatever folder the file is in (`assets.ts`).
* - A driver's listing matches any longer name and, on a local disk, ignores
*   case, so each listed path is matched exactly before it is deleted.
* - A bucket driver with a root lists `/<name>`: the key less the root.
*/
async function deleteFileAndThumbnails(disk, filenameDisk) {
	const { dir: folderPath, name: baseName } = path.posix.parse(filenameDisk);
	const thumbnailPattern = /* @__PURE__ */ new RegExp(`^${escapeRegExp(baseName)}__[0-9a-f]{40}(\\.[^./]+)?$`);
	const listedPrefixes = new Set([path.posix.join(folderPath, baseName), baseName]);
	for (const listedPrefix of listedPrefixes) try {
		for await (const filepath of disk.list(listedPrefix)) {
			const rootedPath = filepath.replace(/^\/+/, "");
			if (rootedPath === filenameDisk || thumbnailPattern.test(rootedPath)) try {
				await disk.delete(filepath);
			} catch (error) {
				ignoreMissingFile(error);
			}
		}
	} catch (error) {
		ignoreMissingFile(error);
	}
}
function ignoreMissingFile(error) {
	if (error.code !== "ENOENT") throw error;
}
function decompressResponse(stream, headers) {
	const contentEncoding = String(headers["content-encoding"] || "").toLowerCase();
	if (![
		"gzip",
		"deflate",
		"br"
	].includes(contentEncoding)) return stream;
	let isEmpty = true;
	const checker = new Transform({
		transform(data, _encoding, callback) {
			if (isEmpty === false) {
				callback(null, data);
				return;
			}
			isEmpty = false;
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
			if (isEmpty && !stream.readable) {
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
export { FilesService, deleteFileAndThumbnails };