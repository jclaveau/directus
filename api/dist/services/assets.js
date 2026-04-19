import { getMilliseconds } from "../utils/get-milliseconds.js";
import { SUPPORTED_IMAGE_TRANSFORM_FORMATS } from "../constants.js";
import { useLogger } from "../logger/index.js";
import { getStorage } from "../storage/index.js";
import { isValidUuid } from "../utils/is-valid-uuid.js";
import database_default from "../database/index.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { maybeExtractFormat, resolvePreset } from "../utils/transformations.js";
import { getSharpInstance } from "./files/lib/get-sharp-instance.js";
import { FilesService } from "./files.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, IllegalAssetTransformationError, InvalidQueryError, RangeNotSatisfiableError, ServiceUnavailableError } from "@directus/errors";
import { clamp } from "lodash-es";
import path from "path";
import hash from "object-hash";
import { contentType } from "mime-types";
import sharp from "sharp";

//#region src/services/assets.ts
const env = useEnv();
const logger = useLogger();
var AssetsService = class {
	knex;
	accountability;
	schema;
	filesService;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
		this.filesService = new FilesService({
			...options,
			accountability: null
		});
	}
	async getAsset(id, transformation, range, deferStream = false) {
		const storage = await getStorage();
		const publicSettings = await this.knex.select("project_logo", "public_background", "public_foreground", "public_favicon").from("directus_settings").first();
		const systemPublicKeys = Object.values(publicSettings || {});
		/**
		* This is a little annoying. Postgres will error out if you're trying to search in `where`
		* with a wrong type. In case of directus_files where id is a uuid, we'll have to verify the
		* validity of the uuid ahead of time.
		*/
		if (!isValidUuid(id)) throw new ForbiddenError();
		if (systemPublicKeys.includes(id) === false && this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "read",
			collection: "directus_files",
			primaryKeys: [id]
		}, {
			knex: this.knex,
			schema: this.schema
		});
		const file = await this.filesService.readOne(id, { limit: 1 });
		if (!await storage.location(file.storage).exists(file.filename_disk)) throw new ForbiddenError();
		if (range) {
			const missingRangeLimits = range.start === void 0 && range.end === void 0;
			const endBeforeStart = range.start !== void 0 && range.end !== void 0 && range.end <= range.start;
			const startOverflow = range.start !== void 0 && range.start >= file.filesize;
			const endUnderflow = range.end !== void 0 && range.end <= 0;
			if (missingRangeLimits || endBeforeStart || startOverflow || endUnderflow) throw new RangeNotSatisfiableError({ range });
			const lastByte = file.filesize - 1;
			if (range.end) {
				if (range.start === void 0) {
					range.start = file.filesize - range.end;
					range.end = lastByte;
				}
				if (range.end >= file.filesize) range.end = lastByte;
			}
			if (range.start) {
				if (range.end === void 0) range.end = lastByte;
				if (range.start < 0) range.start = 0;
			}
		}
		const type = file.type;
		const transforms = transformation ? resolvePreset(transformation, file) : [];
		const modifiedOn = file.modified_on ? new Date(file.modified_on) : void 0;
		const version = modifiedOn ? (modifiedOn.getTime() / 1e3).toFixed() : void 0;
		if (type && transforms.length > 0 && SUPPORTED_IMAGE_TRANSFORM_FORMATS.includes(type)) {
			const maybeNewFormat = maybeExtractFormat(transforms);
			const assetFilename = path.basename(file.filename_disk, path.extname(file.filename_disk)) + getAssetSuffix(transforms) + (maybeNewFormat ? `.${maybeNewFormat}` : path.extname(file.filename_disk));
			const exists = await storage.location(file.storage).exists(assetFilename);
			if (maybeNewFormat) file.type = contentType(assetFilename) || null;
			if (exists) {
				const assetStream$1 = () => storage.location(file.storage).read(assetFilename, { range });
				return {
					stream: deferStream ? assetStream$1 : await assetStream$1(),
					file,
					stat: await storage.location(file.storage).stat(assetFilename)
				};
			}
			const { width, height } = file;
			if (!width || !height || width > env["ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION"] || height > env["ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION"]) {
				logger.warn(`Image is too large to be transformed, or image size couldn't be determined.`);
				throw new IllegalAssetTransformationError({ invalidTransformations: ["width", "height"] });
			}
			const { queue, process } = sharp.counters();
			if (queue + process > env["ASSETS_TRANSFORM_MAX_CONCURRENT"]) throw new ServiceUnavailableError({
				service: "files",
				reason: "Server too busy"
			});
			const transformer = getSharpInstance();
			transformer.timeout({ seconds: clamp(Math.round(getMilliseconds(env["ASSETS_TRANSFORM_TIMEOUT"], 0) / 1e3), 1, 3600) });
			if (transforms.find((transform$1) => transform$1[0] === "rotate") === void 0) transformer.rotate();
			try {
				for (const [method, ...args] of transforms) transformer[method].apply(transformer, args);
			} catch (error) {
				if (error instanceof Error && error.message.startsWith("Expected")) throw new InvalidQueryError({ reason: error.message });
				throw error;
			}
			const readStream = await storage.location(file.storage).read(file.filename_disk, {
				range,
				version
			});
			readStream.on("error", (e) => {
				logger.error(e, `Couldn't transform file ${file.id}`);
				readStream.unpipe(transformer);
			});
			try {
				await storage.location(file.storage).write(assetFilename, readStream.pipe(transformer), type);
			} catch (error) {
				try {
					await storage.location(file.storage).delete(assetFilename);
				} catch {}
				if (error?.message?.includes("timeout")) throw new ServiceUnavailableError({
					service: "assets",
					reason: `Transformation timed out`
				});
				else throw error;
			}
			const assetStream = () => storage.location(file.storage).read(assetFilename, {
				range,
				version
			});
			return {
				stream: deferStream ? assetStream : await assetStream(),
				stat: await storage.location(file.storage).stat(assetFilename),
				file
			};
		} else {
			const assetStream = () => storage.location(file.storage).read(file.filename_disk, {
				range,
				version
			});
			const stat = await storage.location(file.storage).stat(file.filename_disk);
			return {
				stream: deferStream ? assetStream : await assetStream(),
				file,
				stat
			};
		}
	}
};
const getAssetSuffix = (transforms) => {
	if (Object.keys(transforms).length === 0) return "";
	return `__${hash(transforms)}`;
};

//#endregion
export { AssetsService };