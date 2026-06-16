import { useLogger } from "./logger/index.js";
import database_default from "./database/index.js";
import { getSchema } from "./utils/get-schema.js";
import { NetlifyDriver } from "./deployment/drivers/netlify.js";
import { VercelDriver } from "./deployment/drivers/vercel.js";
import "./deployment/drivers/index.js";
import { DeploymentService } from "./services/deployment.js";

//#region src/deployment.ts
/**
* Registry of deployment driver constructors
*/
const drivers = /* @__PURE__ */ new Map();
/**
* Register all deployment drivers
*/
function registerDeploymentDrivers() {
	drivers.set("vercel", VercelDriver);
	drivers.set("netlify", NetlifyDriver);
}
/**
* Get a deployment driver instance
*
* @param provider Provider name (vercel, netlify, aws, etc.)
* @param credentials Provider credentials (decrypted from DB)
* @param options Additional provider options
* @returns Deployment driver instance
* @throws Error if provider is not supported
*/
function getDeploymentDriver(provider, credentials, options) {
	const Driver = drivers.get(provider);
	if (!Driver) throw new Error(`Deployment driver "${provider}" is not supported`);
	return new Driver(credentials, options);
}
/**
* Check if a provider is supported
*/
function isValidProviderType(provider) {
	return drivers.has(provider);
}
/**
* Get list of supported provider types
*/
function getSupportedProviderTypes() {
	return Array.from(drivers.keys());
}
/**
* Sync webhooks for existing deployment configs that don't have one yet.
* Called at startup to handle configs created before webhook support was added.
*/
async function ensureDeploymentWebhooks() {
	const logger = useLogger();
	const service = new DeploymentService({
		knex: database_default(),
		schema: await getSchema(),
		accountability: null
	});
	const configs = await service.readByQuery({ limit: -1 });
	if (!configs || configs.length === 0) {
		logger.debug("[webhook] No deployment configs found");
		return;
	}
	logger.debug(`[webhook] Syncing webhooks for ${configs.length} config(s)...`);
	for (const config of configs) try {
		await service.syncWebhook(config.provider);
	} catch (err) {
		logger.error(`[webhook] Failed to sync webhook for ${config.provider}: ${err}`);
	}
}

//#endregion
export { ensureDeploymentWebhooks, getDeploymentDriver, getSupportedProviderTypes, isValidProviderType, registerDeploymentDrivers };