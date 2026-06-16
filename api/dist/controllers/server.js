import async_handler_default from "../utils/async-handler.js";
import { SettingsService } from "../services/settings.js";
import { respond } from "../middleware/respond.js";
import { ServerService } from "../services/server.js";
import { SpecificationService } from "../services/specifications.js";
import "../services/index.js";
import { getLicenseManager } from "../license/manager.js";
import { createAdmin } from "../utils/create-admin.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, RouteNotFoundError, isDirectusError } from "@directus/errors";
import { toBoolean } from "@directus/utils";
import { Router } from "express";
import { fromZodError } from "zod-validation-error";
import z from "zod";
import { format } from "date-fns";

//#region src/controllers/server.ts
const router = Router();
const env = useEnv();
if (env["OPENAPI_ENABLED"] !== false) router.get("/specs/oas", async_handler_default(async (req, res, next) => {
	const service = new SpecificationService({
		accountability: req.accountability,
		schema: req.schema
	});
	res.locals["payload"] = await service.oas.generate(req.headers.host);
	return next();
}), respond);
if (env["GRAPHQL_INTROSPECTION"] !== false) router.get("/specs/graphql/:scope?", async_handler_default(async (req, res) => {
	const service = new SpecificationService({
		accountability: req.accountability,
		schema: req.schema
	});
	const serverService = new ServerService({
		accountability: req.accountability,
		schema: req.schema
	});
	const scope = req.params["scope"] || "items";
	if (["items", "system"].includes(scope) === false) throw new RouteNotFoundError({ path: req.path });
	const info = await serverService.serverInfo();
	const result = await service.graphql.generate(scope);
	const filename = info["project"].project_name + "_" + format(/* @__PURE__ */ new Date(), "yyyy-MM-dd") + ".graphql";
	res.attachment(filename);
	res.send(result);
}));
router.get("/info", async_handler_default(async (req, res, next) => {
	const data = await new ServerService({
		accountability: req.accountability,
		schema: req.schema
	}).serverInfo();
	res.locals["payload"] = { data };
	return next();
}), respond);
if (toBoolean(env["HEALTHCHECK_ENABLED"]) !== false) router.get("/health", async_handler_default(async (req, res, next) => {
	const data = await new ServerService({
		accountability: req.accountability,
		schema: req.schema
	}).health();
	res.setHeader("Content-Type", "application/health+json");
	if (data["status"] === "error") res.status(503);
	res.locals["payload"] = data;
	res.locals["cache"] = false;
	return next();
}), respond);
const SetupSchema = z.object({
	admin: z.object({
		email: z.string(),
		password: z.string(),
		first_name: z.string().optional(),
		last_name: z.string().optional()
	}),
	license_key: z.string().optional(),
	owner: z.object({
		project_owner: z.string().nullable(),
		project_usage: z.enum([
			"personal",
			"commercial",
			"community"
		]).nullable(),
		org_name: z.string().nullable(),
		product_updates: z.boolean()
	}).optional()
});
router.post("/setup", async_handler_default(async (req, _res, next) => {
	if (await new ServerService({ schema: req.schema }).isSetupCompleted()) throw new ForbiddenError();
	const { error, data } = SetupSchema.safeParse(req.body);
	if (error) throw new InvalidPayloadError({ reason: fromZodError(error).message });
	const licenseManager = getLicenseManager();
	try {
		if (data.license_key) await licenseManager.activate(data.license_key);
		await createAdmin(req.schema, {
			email: data.admin.email,
			password: data.admin.password,
			first_name: data.admin.first_name,
			last_name: data.admin.last_name
		});
		const settingsService = new SettingsService({ schema: req.schema });
		if (data.owner) settingsService.setOwner(data.owner);
	} catch (error$1) {
		if (isDirectusError(error$1, ErrorCode.Forbidden)) return next();
		throw error$1;
	}
	return next();
}), respond);
var server_default = router;

//#endregion
export { server_default as default };