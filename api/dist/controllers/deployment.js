import async_handler_default from "../utils/async-handler.js";
import { useLogger } from "../logger/index.js";
import { DEPLOYMENT_PROVIDER_TYPES } from "../packages/types/dist/index.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import database_default from "../database/index.js";
import { transaction } from "../utils/transaction.js";
import { respond } from "../middleware/respond.js";
import { DeploymentProjectsService } from "../services/deployment-projects.js";
import { DeploymentRunsService } from "../services/deployment-runs.js";
import { DeploymentService } from "../services/deployment.js";
import { MetaService } from "../services/meta.js";
import use_collection_default from "../middleware/use-collection.js";
import { validateBatch } from "../middleware/validate-batch.js";
import { ErrorCode, InvalidPathParameterError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import express from "express";
import Joi from "joi";

//#region src/controllers/deployment.ts
const router = express.Router();
function parseRange(range, defaultMs) {
	const ms = getMilliseconds(range, defaultMs);
	return new Date(Date.now() - ms);
}
router.use(use_collection_default("directus_deployments"));
const validateProvider = (provider) => {
	return DEPLOYMENT_PROVIDER_TYPES.includes(provider);
};
const deploymentSchema = Joi.object({
	provider: Joi.string().valid(...DEPLOYMENT_PROVIDER_TYPES).required(),
	credentials: Joi.object().required(),
	options: Joi.object()
}).unknown();
router.post("/", async_handler_default(async (req, res, next) => {
	const { error } = deploymentSchema.validate(req.body);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const item = await transaction(database_default(), async (trx) => {
		const service = new DeploymentService({
			accountability: req.accountability,
			schema: req.schema,
			knex: trx
		});
		const key = await service.createOne({
			provider: req.body.provider,
			credentials: req.body.credentials,
			options: req.body.options
		});
		return service.readOne(key, req.sanitizedQuery);
	});
	res.locals["payload"] = { data: item };
	return next();
}), respond);
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	});
	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema
	});
	const records = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery(req.collection, req.sanitizedQuery);
	res.locals["payload"] = {
		data: records || null,
		meta
	};
	return next();
});
router.get("/", validateBatch("read"), readHandler, respond);
router.search("/", validateBatch("read"), readHandler, respond);
router.get("/:provider", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const record = await new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	}).readByProvider(provider, req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
router.get("/:provider/projects", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const service = new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	});
	const projectsService = new DeploymentProjectsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const deployment = await service.readByProvider(provider);
	const { data: providerProjects, remainingTTL } = await service.listProviderProjects(provider);
	const projects = await projectsService.listWithSync(deployment.id, providerProjects);
	res.locals["cache"] = false;
	res.locals["cacheTTL"] = remainingTTL;
	res.locals["payload"] = { data: projects };
	return next();
}), respond);
router.get("/:provider/projects/:id", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	const projectId = req.params["id"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const service = new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	});
	const project = await new DeploymentProjectsService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(projectId);
	const { data: details, remainingTTL } = await service.getProviderProject(provider, project.external_id);
	res.locals["cache"] = false;
	res.locals["cacheTTL"] = remainingTTL;
	res.locals["payload"] = { data: {
		...details,
		id: project.id,
		external_id: project.external_id
	} };
	return next();
}), respond);
const updateProjectsSchema = Joi.object({
	create: Joi.array().items(Joi.object({
		external_id: Joi.string().required(),
		name: Joi.string().required()
	})).default([]),
	delete: Joi.array().items(Joi.string()).default([])
});
router.patch("/:provider/projects", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const { error, value } = updateProjectsSchema.validate(req.body);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const service = new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	});
	const projectsService = new DeploymentProjectsService({
		accountability: req.accountability,
		schema: req.schema
	});
	if (value.create.length > 0) await projectsService.validateDeployable(provider, value.create);
	const updatedProjects = await projectsService.updateSelection(provider, value.create, value.delete);
	service.syncWebhook(provider).catch((err) => {
		useLogger().error(`Failed to sync webhook for ${provider}: ${err}`);
	});
	res.locals["payload"] = { data: updatedProjects };
	return next();
}), respond);
const rangeQuerySchema = Joi.object({ range: Joi.string().pattern(/^\d+(ms|s|m|h|d|w|y)$/).optional() });
router.get("/:provider/dashboard", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const { error, value } = rangeQuerySchema.validate(req.query);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const sinceDate = parseRange(value.range, 864e5);
	const data = await new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	}).getDashboard(provider, sinceDate);
	res.locals["cache"] = false;
	res.locals["payload"] = { data };
	return next();
}), respond);
const triggerDeploySchema = Joi.object({
	preview: Joi.boolean().default(false),
	clear_cache: Joi.boolean().default(true)
});
router.post("/:provider/projects/:id/deploy", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	const projectId = req.params["id"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const { error, value } = triggerDeploySchema.validate(req.body);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const run = await new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	}).triggerDeployment(provider, projectId, {
		preview: value.preview,
		clearCache: value.clear_cache
	});
	res.locals["payload"] = { data: run };
	return next();
}), respond);
router.patch("/:provider", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const item = await transaction(database_default(), async (trx) => {
		const service = new DeploymentService({
			accountability: req.accountability,
			schema: req.schema,
			knex: trx
		});
		const data = {};
		if ("credentials" in req.body) data["credentials"] = req.body.credentials;
		if ("options" in req.body) data["options"] = req.body.options;
		const primaryKey = await service.updateByProvider(provider, data);
		try {
			return await service.readOne(primaryKey, req.sanitizedQuery);
		} catch (error) {
			if (isDirectusError(error, ErrorCode.Forbidden)) return null;
			throw error;
		}
	});
	res.locals["payload"] = { data: item };
	return next();
}), respond);
router.delete("/:provider", async_handler_default(async (req, _res, next) => {
	const provider = req.params["provider"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	await new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	}).deleteByProvider(provider);
	return next();
}), respond);
router.get("/:provider/projects/:id/runs", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	const projectId = req.params["id"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const projectsService = new DeploymentProjectsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const runsService = new DeploymentRunsService({
		accountability: req.accountability,
		schema: req.schema
	});
	await projectsService.readOne(projectId);
	const query = {
		...req.sanitizedQuery,
		filter: { project: { _eq: projectId } },
		sort: ["-date_created"],
		limit: req.sanitizedQuery.limit ?? 10,
		fields: [
			"*",
			"user_created.first_name",
			"user_created.last_name",
			"user_created.email"
		]
	};
	const runs = await runsService.readByQuery(query);
	const meta = await new MetaService({
		accountability: req.accountability,
		schema: req.schema
	}).getMetaForQuery("directus_deployment_runs", query);
	res.locals["payload"] = {
		data: runs,
		meta
	};
	return next();
}), respond);
router.get("/:provider/projects/:id/runs/stats", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	const projectId = req.params["id"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const { error, value } = rangeQuerySchema.validate(req.query);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const sinceDate = parseRange(value.range, 6048e5).toISOString();
	const projectsService = new DeploymentProjectsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const runsService = new DeploymentRunsService({
		accountability: req.accountability,
		schema: req.schema
	});
	await projectsService.readOne(projectId);
	const data = await runsService.getStats(projectId, sinceDate);
	res.locals["cache"] = false;
	res.locals["payload"] = { data };
	return next();
}), respond);
const runDetailsQuerySchema = Joi.object({
	since: Joi.date().iso().optional(),
	_t: Joi.number().optional()
});
router.get("/:provider/runs/:id", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	const runId = req.params["id"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const { error, value } = runDetailsQuerySchema.validate(req.query);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const data = await new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	}).getRunWithLogs(provider, runId, value.since);
	res.locals["cache"] = false;
	res.locals["payload"] = { data };
	return next();
}), respond);
router.post("/:provider/runs/:id/cancel", async_handler_default(async (req, res, next) => {
	const provider = req.params["provider"];
	const runId = req.params["id"];
	if (!validateProvider(provider)) throw new InvalidPathParameterError({ reason: `${provider} is not a supported provider` });
	const data = await new DeploymentService({
		accountability: req.accountability,
		schema: req.schema
	}).cancelDeployment(provider, runId);
	res.locals["payload"] = { data };
	return next();
}), respond);
var deployment_default = router;

//#endregion
export { deployment_default as default };