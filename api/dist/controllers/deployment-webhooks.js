import async_handler_default from "../utils/async-handler.js";
import { useLogger } from "../logger/index.js";
import { DEPLOYMENT_PROVIDER_TYPES } from "../packages/types/dist/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { getSchema } from "../utils/get-schema.js";
import { getDeploymentDriver } from "../deployment.js";
import { DeploymentProjectsService } from "../services/deployment-projects.js";
import { DeploymentRunsService } from "../services/deployment-runs.js";
import { DeploymentService } from "../services/deployment.js";
import express from "express";

//#region src/controllers/deployment-webhooks.ts
const router = express.Router();
router.post("/:provider", async_handler_default(async (req, res) => {
	const logger = useLogger();
	const provider = req.params["provider"];
	if (!DEPLOYMENT_PROVIDER_TYPES.includes(provider)) return res.sendStatus(404);
	const rawBody = req.rawBody;
	if (!rawBody) {
		logger.debug(`[webhook:${provider}] No raw body`);
		return res.sendStatus(400);
	}
	const schema = await getSchema();
	const knex = database_default();
	const deploymentService = new DeploymentService({
		schema,
		knex,
		accountability: null
	});
	let webhookConfig;
	try {
		webhookConfig = await deploymentService.getWebhookConfig(provider);
	} catch {
		logger.warn(`[webhook:${provider}] No webhook config found`);
		return res.sendStatus(404);
	}
	if (!webhookConfig.webhook_secret) {
		logger.warn(`[webhook:${provider}] No webhook secret configured`);
		return res.sendStatus(404);
	}
	const driver = getDeploymentDriver(provider, webhookConfig.credentials, webhookConfig.options);
	const headers = { ...req.headers };
	const queryToken = req.query["token"];
	if (typeof queryToken === "string") headers["x-webhook-token"] = queryToken;
	const event = driver.verifyAndParseWebhook(rawBody, headers, webhookConfig.webhook_secret);
	if (!event) {
		logger.warn(`[webhook:${provider}] Verification failed or unknown event`);
		try {
			const body = JSON.parse(rawBody.toString("utf-8"));
			logger.warn(`[webhook:${provider}] Raw event type: ${body.type ?? body.state ?? "unknown"}`);
		} catch {
			logger.warn(`[webhook:${provider}] Unparseable body: ${rawBody.toString("utf-8").slice(0, 200)}`);
		}
		return res.sendStatus(401);
	}
	const project = await new DeploymentProjectsService({
		schema,
		knex,
		accountability: null
	}).readByExternalId(event.project_external_id);
	if (!project) {
		logger.info(`[webhook:${provider}] Project ${event.project_external_id} not tracked`);
		return res.sendStatus(410);
	}
	const runId = await new DeploymentRunsService({
		schema,
		knex,
		accountability: null
	}).processWebhookEvent(project.id, event);
	const eventPayload = {
		provider,
		project_id: project.id,
		run_id: runId,
		external_id: event.deployment_external_id,
		status: event.status,
		url: event.url,
		target: event.target,
		timestamp: event.timestamp
	};
	emitter_default.emitAction(["deployment.webhook", `deployment.webhook.${event.type}`], eventPayload, null);
	logger.info(`[webhook:${provider}] Processed: ${event.type} → run ${runId}`);
	return res.sendStatus(200);
}));
var deployment_webhooks_default = router;

//#endregion
export { deployment_webhooks_default as default };