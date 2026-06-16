import async_handler_default from "../utils/async-handler.js";
import { getConfigFromEnv } from "../utils/get-config-from-env.js";
import { useLogger } from "../logger/index.js";
import { TransformationMethods } from "../packages/types/dist/index.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import { ASSET_TRANSFORM_QUERY_KEYS, SYSTEM_ASSET_ALLOW_LIST } from "../constants.js";
import { isValidUuid } from "../utils/is-valid-uuid.js";
import database_default from "../database/index.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { PayloadService } from "../services/payload.js";
import { FilesService } from "../services/files.js";
import { AssetsService } from "../services/assets.js";
import { getCacheControlHeader } from "../utils/get-cache-headers.js";
import use_collection_default from "../middleware/use-collection.js";
import is_locked_default from "../middleware/is-locked.js";
import { useEnv } from "@directus/env";
import { InvalidPayloadError, InvalidQueryError, RangeNotSatisfiableError } from "@directus/errors";
import { getDateTimeFormatted, parseJSON } from "@directus/utils";
import { Router } from "express";
import { merge, pick } from "lodash-es";
import { fromZodError } from "zod-validation-error";
import * as z$2 from "zod";
import contentDisposition from "content-disposition";

//#region src/controllers/assets.ts
const router = Router();
const env = useEnv();
router.use(use_collection_default("directus_files"));
router.use(is_locked_default("assets"));
router.post("/folder/:pk", async_handler_default(async (req, res) => {
	const logger = useLogger();
	const { archive, complete, metadata } = await new AssetsService({
		accountability: req.accountability,
		schema: req.schema
	}).zipFolder(req.params["pk"]);
	res.setHeader("Content-Type", "application/zip");
	const folderName = `folder-${metadata["name"] ? metadata["name"] : "unknown"}-${getDateTimeFormatted()}.zip`;
	res.setHeader("Content-Disposition", contentDisposition(folderName, { type: "attachment" }));
	res.on("close", () => {
		if (!res.writableEnded) {
			archive.destroy();
			archive.abort();
		}
	});
	archive.pipe(res);
	try {
		await complete();
	} catch (error) {
		logger.error(error, `Couldn't archive folder ${req.params["pk"]} to the client`);
		archive.destroy();
		if (!res.headersSent) {
			res.removeHeader("Content-Type");
			res.removeHeader("Content-Disposition");
			res.removeHeader("Cache-Control");
			res.status(500).json({ errors: [{
				message: "An unexpected error occurred.",
				extensions: { code: "INTERNAL_SERVER_ERROR" }
			}] });
		} else res.end();
	}
}));
router.post("/files/", async_handler_default(async (req, res) => {
	const logger = useLogger();
	const service = new AssetsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const { error, data } = z$2.object({ ids: z$2.array(z$2.string().refine((v) => isValidUuid(v), { error: "\"id\" must be a uuid" })).min(1) }).safeParse(req.body);
	if (error) throw new InvalidPayloadError({ reason: fromZodError(error).message });
	const { archive, complete } = await service.zipFiles(data.ids);
	res.setHeader("Content-Type", "application/zip");
	res.setHeader("Content-Disposition", `attachment; filename="files-${getDateTimeFormatted()}.zip"`);
	res.on("close", () => {
		if (!res.writableEnded) {
			archive.destroy();
			archive.abort();
		}
	});
	archive.pipe(res);
	try {
		await complete();
	} catch (error$1) {
		logger.error(error$1, `Couldn't archive files to the client`);
		archive.destroy();
		if (!res.headersSent) {
			res.removeHeader("Content-Type");
			res.removeHeader("Content-Disposition");
			res.removeHeader("Cache-Control");
			res.status(500).json({ errors: [{
				message: "An unexpected error occurred.",
				extensions: { code: "INTERNAL_SERVER_ERROR" }
			}] });
		} else res.end();
	}
}));
router.get("/:pk/:filename?", async_handler_default(async (req, res, next) => {
	const payloadService = new PayloadService("directus_settings", { schema: req.schema });
	const defaults = {
		storage_asset_presets: [],
		storage_asset_transform: "all"
	};
	const savedAssetSettings = await database_default().select("storage_asset_presets", "storage_asset_transform").from("directus_settings").first();
	if (savedAssetSettings) await payloadService.processValues("read", savedAssetSettings);
	const assetSettings = savedAssetSettings || defaults;
	const transformation = pick(req.query, ASSET_TRANSFORM_QUERY_KEYS);
	if ("transforms" in transformation) {
		let transforms;
		try {
			transforms = parseJSON(transformation["transforms"]);
		} catch {
			throw new InvalidQueryError({ reason: `"transforms" Parameter needs to be a JSON array of allowed transformations` });
		}
		if (!Array.isArray(transforms)) throw new InvalidQueryError({ reason: `"transforms" Parameter needs to be a JSON array of allowed transformations` });
		if (transforms.length > Number(env["ASSETS_TRANSFORM_MAX_OPERATIONS"])) throw new InvalidQueryError({ reason: `"transforms" Parameter is only allowed ${env["ASSETS_TRANSFORM_MAX_OPERATIONS"]} transformations` });
		transforms.forEach((transform$1) => {
			const name = transform$1[0];
			if (!TransformationMethods.includes(name)) throw new InvalidQueryError({ reason: `"transforms" Parameter does not allow "${name}" as a transformation` });
		});
		transformation["transforms"] = transforms;
	}
	const systemKeys = SYSTEM_ASSET_ALLOW_LIST.map((transformation$1) => transformation$1["key"]);
	const allKeys = [...systemKeys, ...(assetSettings.storage_asset_presets || []).map((transformation$1) => transformation$1["key"])];
	res.locals["shortcuts"] = [...SYSTEM_ASSET_ALLOW_LIST, ...assetSettings.storage_asset_presets || []];
	res.locals["transformation"] = transformation;
	if (Object.keys(transformation).length === 0 || "transforms" in transformation && transformation["transforms"].length === 0) return next();
	if (assetSettings.storage_asset_transform === "all") {
		if (transformation["key"] && allKeys.includes(transformation["key"]) === false) throw new InvalidQueryError({ reason: `Key "${transformation["key"]}" isn't configured` });
		return next();
	} else if (assetSettings.storage_asset_transform === "presets") {
		if (allKeys.includes(transformation["key"]) && Object.keys(transformation).length === 1) return next();
		throw new InvalidQueryError({ reason: `Only configured presets can be used in asset generation` });
	} else {
		if (transformation["key"] && systemKeys.includes(transformation["key"]) && Object.keys(transformation).length === 1) return next();
		throw new InvalidQueryError({ reason: `Dynamic asset generation has been disabled for this project` });
	}
}), async_handler_default(async (req, res, next) => {
	return (await import("helmet")).contentSecurityPolicy(merge({
		useDefaults: false,
		directives: { defaultSrc: [`'none'`] }
	}, getConfigFromEnv("ASSETS_CONTENT_SECURITY_POLICY")))(req, res, next);
}), async_handler_default(async (req, res) => {
	const logger = useLogger();
	const id = req.params["pk"].substring(0, 36);
	const service = new AssetsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const vary = ["Origin", "Cache-Control"];
	const transformationParams = {
		...res.locals["shortcuts"].find((transformation) => transformation["key"] === res.locals["transformation"]?.key),
		...res.locals["transformation"]
	};
	let acceptFormat;
	if (transformationParams.format === "auto") {
		if (req.headers.accept?.includes("image/avif")) acceptFormat = "avif";
		else if (req.headers.accept?.includes("image/webp")) acceptFormat = "webp";
		vary.push("Accept");
	}
	let range = void 0;
	if (req.headers.range && Object.keys(transformationParams).length === 0) {
		const rangeParts = /bytes=([0-9]*)-([0-9]*)/.exec(req.headers.range);
		if (rangeParts && rangeParts.length > 1) {
			range = {
				start: void 0,
				end: void 0
			};
			if (rangeParts[1]) {
				range.start = Number(rangeParts[1]);
				if (Number.isNaN(range.start)) throw new RangeNotSatisfiableError({ range });
			}
			if (rangeParts[2]) {
				range.end = Number(rangeParts[2]);
				if (Number.isNaN(range.end)) throw new RangeNotSatisfiableError({ range });
			}
		}
	}
	const revalidate = env["ASSETS_CACHE_REVALIDATE"] === true;
	if (revalidate) {
		const ifNoneMatch = req.headers["if-none-match"];
		const ifModifiedSince = req.headers["if-modified-since"];
		if (ifNoneMatch || ifModifiedSince) {
			if (req.accountability) await validateAccess({
				accountability: req.accountability,
				action: "read",
				collection: "directus_files",
				primaryKeys: [id]
			}, {
				knex: database_default(),
				schema: req.schema
			});
			const fileRecord = await new FilesService({ schema: req.schema }).readOne(id, { fields: ["modified_on"] });
			if (fileRecord?.modified_on) {
				const modifiedOnTime = new Date(fileRecord.modified_on).getTime();
				const etag = `"${Math.floor(modifiedOnTime / 1e3)}"`;
				if (ifNoneMatch === etag) {
					res.setHeader("Cache-Control", "max-age=0, must-revalidate");
					res.setHeader("ETag", etag);
					res.setHeader("Last-Modified", new Date(modifiedOnTime).toUTCString());
					res.status(304);
					return res.end();
				}
				if (ifModifiedSince) {
					const ifModifiedSinceTime = new Date(ifModifiedSince).getTime();
					if (Math.floor(modifiedOnTime / 1e3) <= Math.floor(ifModifiedSinceTime / 1e3)) {
						res.setHeader("Cache-Control", "max-age=0, must-revalidate");
						res.setHeader("ETag", etag);
						res.setHeader("Last-Modified", new Date(modifiedOnTime).toUTCString());
						res.status(304);
						return res.end();
					}
				}
			}
		}
	}
	const { stream, file, stat } = await service.getAsset(id, {
		transformationParams,
		acceptFormat
	}, range, true);
	const filename = req.params["filename"] ?? file.filename_download ?? file.id;
	res.attachment(filename);
	res.setHeader("Content-Type", file.type);
	res.setHeader("Accept-Ranges", "bytes");
	if (revalidate) res.setHeader("Cache-Control", "max-age=0, must-revalidate");
	else res.setHeader("Cache-Control", getCacheControlHeader(req, getMilliseconds(env["ASSETS_CACHE_TTL"]), false, true));
	res.setHeader("Vary", vary.join(", "));
	const unixTime = Date.parse(file.modified_on);
	if (!Number.isNaN(unixTime)) {
		const lastModifiedDate = new Date(unixTime);
		res.setHeader("Last-Modified", lastModifiedDate.toUTCString());
		res.setHeader("ETag", `"${Math.floor(unixTime / 1e3)}"`);
	}
	if (range) {
		res.setHeader("Content-Range", `bytes ${range.start}-${range.end || stat.size - 1}/${stat.size}`);
		res.status(206);
		res.setHeader("Content-Length", (range.end ? range.end + 1 : stat.size) - (range.start || 0));
	} else res.setHeader("Content-Length", stat.size);
	if ("download" in req.query === false) res.setHeader("Content-Disposition", contentDisposition(filename, { type: "inline" }));
	if (req.method.toLowerCase() === "head") {
		res.status(200);
		res.setHeader("Accept-Ranges", "bytes");
		res.setHeader("Content-Length", stat.size);
		return res.end();
	}
	const sourceStream = await stream();
	res.on("close", () => {
		if (!res.writableEnded) sourceStream.destroy();
	});
	sourceStream.on("error", (error) => {
		logger.error(error, `Couldn't stream file ${file.id} to the client`);
		sourceStream.destroy();
		if (!res.headersSent) {
			res.removeHeader("Content-Type");
			res.removeHeader("Content-Disposition");
			res.removeHeader("Cache-Control");
			res.status(500).json({ errors: [{
				message: "An unexpected error occurred.",
				extensions: { code: "INTERNAL_SERVER_ERROR" }
			}] });
		} else res.end();
	}).pipe(res);
}));
var assets_default = router;

//#endregion
export { assets_default as default };