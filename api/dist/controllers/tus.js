import async_handler_default from "../utils/async-handler.js";
import database_default from "../database/index.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { createTusServer } from "../services/tus/server.js";
import "../services/tus/index.js";
import { createError } from "@directus/errors";
import { Router } from "express";
import { ERRORS, Metadata } from "@tus/utils";

//#region src/controllers/tus.ts
const mapAction = (method) => {
	switch (method) {
		case "POST": return "create";
		case "PATCH": return "update";
		case "DELETE": return "delete";
		default: return "read";
	}
};
const checkFileAccess = async_handler_default(async (req, _res, next) => {
	if (req.accountability) {
		const validateAccessOptions = {
			action: mapAction(req.method),
			collection: "directus_files",
			accountability: req.accountability
		};
		if (req.method === "POST" && req.header("upload-metadata")) {
			let metadata;
			try {
				metadata = Metadata.parse(req.header("upload-metadata"));
			} catch {
				throw new (createError("INVALID_METADATA", ERRORS.INVALID_METADATA.body, ERRORS.INVALID_METADATA.status_code))();
			}
			if (metadata["id"]) {
				validateAccessOptions.action = "update";
				validateAccessOptions.primaryKeys = [metadata["id"]];
			}
			const fields = [];
			for (const field of Object.keys(req.schema.collections["directus_files"].fields)) {
				if (field === "id") continue;
				if (field in metadata) fields.push(field);
			}
			if (fields.length > 0) validateAccessOptions.fields = fields;
		}
		await validateAccess(validateAccessOptions, {
			schema: req.schema,
			knex: database_default()
		});
	}
	return next();
});
const handler = async_handler_default(async (req, res) => {
	const [tusServer, cleanupServer] = await createTusServer({
		schema: req.schema,
		accountability: req.accountability
	});
	await tusServer.handle(req, res);
	cleanupServer();
});
const router = Router();
router.post("/", checkFileAccess, handler);
router.patch("/:id", checkFileAccess, handler);
router.delete("/:id", checkFileAccess, handler);
router.options("/:id", checkFileAccess, handler);
router.head("/:id", checkFileAccess, handler);
var tus_default = router;

//#endregion
export { tus_default as default };