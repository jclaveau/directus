import async_handler_default from "../utils/async-handler.js";
import { useLogger } from "../logger/index.js";
import { respond } from "../middleware/respond.js";
import { getVersionedHash } from "../utils/get-versioned-hash.js";
import { SchemaService } from "../services/schema.js";
import { InvalidPayloadError, UnsupportedMediaTypeError } from "@directus/errors";
import { parseJSON, toBoolean } from "@directus/utils";
import express from "express";
import { load } from "js-yaml";
import Busboy from "busboy";

//#region src/controllers/schema.ts
const router = express.Router();
router.get("/snapshot", async_handler_default(async (req, res, next) => {
	const currentSnapshot = await new SchemaService({ accountability: req.accountability }).snapshot();
	res.locals["payload"] = { data: currentSnapshot };
	return next();
}), respond);
const schemaMultipartHandler = (req, res, next) => {
	if (req.is("application/json")) {
		if (Object.keys(req.body).length === 0) throw new InvalidPayloadError({ reason: `No data was included in the body` });
		res.locals["upload"] = req.body;
		return next();
	}
	if (!req.is("multipart/form-data")) throw new UnsupportedMediaTypeError({
		mediaType: req.headers["content-type"],
		where: "Content-Type header"
	});
	const busboy = Busboy({ headers: req.headers["content-type"] ? req.headers : {
		...req.headers,
		"content-type": "application/octet-stream"
	} });
	let isFileIncluded = false;
	let upload = null;
	busboy.on("file", async (_, fileStream, { mimeType }) => {
		const logger = useLogger();
		if (isFileIncluded) return next(new InvalidPayloadError({ reason: `More than one file was included in the body` }));
		isFileIncluded = true;
		const { readableStreamToString } = await import("@directus/utils/node");
		try {
			const uploadedString = await readableStreamToString(fileStream);
			if (mimeType === "application/json") try {
				upload = parseJSON(uploadedString);
			} catch (err) {
				logger.warn(err);
				throw new InvalidPayloadError({ reason: "The provided JSON is invalid" });
			}
			else try {
				upload = await load(uploadedString);
			} catch (err) {
				logger.warn(err);
				throw new InvalidPayloadError({ reason: "The provided YAML is invalid" });
			}
			if (!upload) throw new InvalidPayloadError({ reason: `No file was included in the body` });
			res.locals["upload"] = upload;
			return next();
		} catch (error) {
			busboy.emit("error", error);
		}
	});
	busboy.on("error", (error) => next(error));
	busboy.on("close", () => {
		if (!isFileIncluded) return next(new InvalidPayloadError({ reason: `No file was included in the body` }));
	});
	req.pipe(busboy);
};
router.post("/diff", async_handler_default(schemaMultipartHandler), async_handler_default(async (req, res, next) => {
	const service = new SchemaService({ accountability: req.accountability });
	const snapshot = res.locals["upload"];
	const currentSnapshot = await service.snapshot();
	const snapshotDiff = await service.diff(snapshot, {
		currentSnapshot,
		force: "force" in req.query
	});
	if (!snapshotDiff) return next();
	const currentSnapshotHash = getVersionedHash(currentSnapshot);
	res.locals["payload"] = { data: {
		hash: currentSnapshotHash,
		diff: snapshotDiff
	} };
	return next();
}), respond);
router.post("/apply", async_handler_default(schemaMultipartHandler), async_handler_default(async (req, res, next) => {
	const service = new SchemaService({ accountability: req.accountability });
	const diff = res.locals["upload"];
	await service.apply(diff, { force: toBoolean(req.query["force"]) });
	return next();
}), respond);
var schema_default = router;

//#endregion
export { schema_default as default };