import { useLogger } from "../logger/index.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import { getCache, getCacheValueWithTTL, setCacheValueWithExpiry } from "../cache.js";
import { ItemsService } from "./items.js";
import { getDeploymentDriver } from "../deployment.js";
import { parseValue } from "../utils/parse-value.js";
import { DeploymentProjectsService } from "./deployment-projects.js";
import { DeploymentRunsService } from "./deployment-runs.js";
import { useEnv } from "@directus/env";
import { InvalidPayloadError, InvalidProviderConfigError } from "@directus/errors";
import { mergeFilters } from "@directus/utils";
import { has, isEmpty } from "lodash-es";

//#region src/services/deployment.ts
const env = useEnv();
const DEPLOYMENT_CACHE_TTL = getMilliseconds(env["CACHE_DEPLOYMENT_TTL"]) || 5e3;
const SYNC_THRESHOLD_MS = 3600 * 1e3;
var DeploymentService = class DeploymentService extends ItemsService {
	constructor(options) {
		super("directus_deployments", options);
	}
	async createOne(data, opts) {
		const provider = data.provider;
		if (!provider) throw new InvalidPayloadError({ reason: "Provider is required" });
		if (isEmpty(data.credentials)) throw new InvalidPayloadError({ reason: "Credentials are required" });
		let credentials;
		try {
			credentials = parseValue(data.credentials, {});
		} catch {
			throw new InvalidPayloadError({ reason: "Credentials must be valid JSON" });
		}
		let options;
		try {
			options = parseValue(data.options, void 0);
		} catch {
			throw new InvalidPayloadError({ reason: "Options must be valid JSON" });
		}
		const driver = getDeploymentDriver(provider, credentials, options);
		try {
			await driver.testConnection();
		} catch {
			throw new InvalidProviderConfigError({
				provider,
				reason: "Invalid config connection"
			});
		}
		const payload = {
			...data,
			credentials: JSON.stringify(credentials)
		};
		if (!isEmpty(options)) payload.options = JSON.stringify(options);
		return super.createOne(payload, opts);
	}
	async updateOne(key, data, opts) {
		const hasCredentials = has(data, "credentials");
		const hasOptions = has(data, "options");
		if (!hasCredentials && !hasOptions) return super.updateOne(key, data, opts);
		const existing = await this.readOne(key);
		const provider = existing.provider;
		let credentials = parseValue((await this.readConfig(provider)).credentials, {});
		if (hasCredentials) try {
			const parsed = parseValue(data.credentials, {});
			credentials = {
				...credentials,
				...parsed
			};
		} catch {
			throw new InvalidPayloadError({ reason: "Credentials must be valid JSON or object" });
		}
		let options = existing.options ?? void 0;
		if (hasOptions) {
			try {
				options = parseValue(data.options, void 0);
			} catch {
				throw new InvalidPayloadError({ reason: "Options must be valid JSON" });
			}
			if (isEmpty(options)) throw new InvalidPayloadError({ reason: "Options must not be empty" });
		}
		const driver = getDeploymentDriver(provider, credentials, options);
		try {
			await driver.testConnection();
		} catch {
			throw new InvalidProviderConfigError({
				provider,
				reason: "Invalid config connection"
			});
		}
		return super.updateOne(key, {
			credentials: JSON.stringify(credentials),
			...!isEmpty(options) ? { options: JSON.stringify(options) } : {}
		}, opts);
	}
	/**
	* Read deployment config by provider
	*/
	async readByProvider(provider, query) {
		const results = await this.readByQuery({
			...query,
			filter: mergeFilters({ provider: { _eq: provider } }, query?.filter ?? null),
			limit: 1
		});
		if (!results || results.length === 0) throw new Error(`Deployment config for "${provider}" not found`);
		return results[0];
	}
	/**
	* Update deployment config by provider
	*/
	async updateByProvider(provider, data) {
		const deployment = await this.readByProvider(provider);
		return this.updateOne(deployment.id, data);
	}
	/**
	* Delete deployment config by provider
	*/
	async deleteByProvider(provider) {
		const deployment = await this.readByProvider(provider);
		if (deployment.webhook_ids && deployment.webhook_ids.length > 0) try {
			await (await this.getDriver(provider)).unregisterWebhook(deployment.webhook_ids);
		} catch (err) {
			useLogger().error(`Failed to unregister webhook for ${provider}: ${err}`);
		}
		return this.deleteOne(deployment.id);
	}
	/**
	* Read deployment config with decrypted credentials (internal use)
	*/
	async readConfig(provider) {
		const results = await new ItemsService("directus_deployments", {
			knex: this.knex,
			schema: this.schema,
			accountability: null
		}).readByQuery({
			filter: { provider: { _eq: provider } },
			limit: 1
		});
		if (!results || results.length === 0) throw new Error(`Deployment config for "${provider}" not found`);
		return results[0];
	}
	/**
	* Get webhook config for a provider
	*/
	async getWebhookConfig(provider) {
		const config = await this.readConfig(provider);
		return {
			webhook_secret: config.webhook_secret ?? null,
			credentials: parseValue(config.credentials, {}),
			options: parseValue(config.options, {})
		};
	}
	/**
	* Get a deployment driver instance with decrypted credentials
	*/
	async getDriver(provider) {
		const deployment = await this.readConfig(provider);
		const credentials = parseValue(deployment.credentials, {});
		const options = parseValue(deployment.options, {});
		return getDeploymentDriver(deployment.provider, credentials, options);
	}
	/**
	* Sync webhook registration with current tracked projects.
	*/
	async syncWebhook(provider) {
		const logger = useLogger();
		logger.debug(`[webhook:${provider}] Starting webhook sync`);
		const config = await this.readConfig(provider);
		const projectExternalIds = (await new ItemsService("directus_deployment_projects", {
			knex: this.knex,
			schema: this.schema,
			accountability: null
		}).readByQuery({
			filter: { deployment: { _eq: config.id } },
			limit: -1
		})).map((p) => p.external_id);
		const driver = await this.getDriver(provider);
		if (projectExternalIds.length === 0) {
			if (config.webhook_ids && config.webhook_ids.length > 0) {
				logger.debug(`[webhook:${provider}] No projects, unregistering ${config.webhook_ids.length} webhook(s)`);
				try {
					await driver.unregisterWebhook(config.webhook_ids);
				} catch (err) {
					logger.warn(`[webhook:${provider}] Failed to unregister: ${err}`);
				}
				await super.updateOne(config.id, {
					webhook_ids: null,
					webhook_secret: null
				});
			}
			return;
		}
		if (config.webhook_ids && config.webhook_ids.length > 0) {
			logger.debug(`[webhook:${provider}] Unregistering ${config.webhook_ids.length} existing webhook(s)`);
			try {
				await driver.unregisterWebhook(config.webhook_ids);
			} catch (err) {
				logger.warn(`[webhook:${provider}] Failed to unregister: ${err}`);
			}
		}
		const webhookUrl = `${env["PUBLIC_URL"]}/deployments/webhooks/${provider}`;
		logger.debug(`[webhook:${provider}] Registering webhook → ${webhookUrl} for ${projectExternalIds.length} project(s)`);
		const result = await driver.registerWebhook(webhookUrl, projectExternalIds);
		await super.updateOne(config.id, {
			webhook_ids: result.webhook_ids,
			webhook_secret: result.webhook_secret
		});
		logger.info(`[webhook:${provider}] Registered ${result.webhook_ids.length} webhook(s): [${result.webhook_ids.join(", ")}]`);
	}
	/**
	* List projects from provider with caching
	*/
	async listProviderProjects(provider) {
		const cacheKey = `${provider}:projects`;
		const { deploymentCache } = getCache();
		const cached = await getCacheValueWithTTL(deploymentCache, cacheKey);
		if (cached) return {
			data: cached.data,
			remainingTTL: cached.remainingTTL
		};
		const projects = await (await this.getDriver(provider)).listProjects();
		await setCacheValueWithExpiry(deploymentCache, cacheKey, projects, DEPLOYMENT_CACHE_TTL);
		return {
			data: projects,
			remainingTTL: DEPLOYMENT_CACHE_TTL
		};
	}
	/**
	* Get project details from provider with caching
	*/
	async getProviderProject(provider, projectId) {
		const cacheKey = `${provider}:project:${projectId}`;
		const { deploymentCache } = getCache();
		const cached = await getCacheValueWithTTL(deploymentCache, cacheKey);
		if (cached) return {
			data: cached.data,
			remainingTTL: cached.remainingTTL
		};
		const project = await (await this.getDriver(provider)).getProject(projectId);
		await setCacheValueWithExpiry(deploymentCache, cacheKey, project, DEPLOYMENT_CACHE_TTL);
		return {
			data: project,
			remainingTTL: DEPLOYMENT_CACHE_TTL
		};
	}
	/**
	* Dashboard: projects + latest run status + stats
	*/
	async getDashboard(provider, sinceDate) {
		const projectsService = new DeploymentProjectsService({
			accountability: this.accountability,
			schema: this.schema
		});
		const runsService = new DeploymentRunsService({
			accountability: this.accountability,
			schema: this.schema
		});
		const deployment = await this.readByProvider(provider);
		const selectedProjects = await projectsService.readByQuery({
			filter: { deployment: { _eq: deployment.id } },
			limit: -1
		});
		if (selectedProjects.length === 0) return {
			projects: [],
			stats: {
				active_deployments: 0,
				successful_builds: 0,
				failed_builds: 0
			}
		};
		const projectIds = selectedProjects.map((p) => p.id);
		const [latestRuns, activeResult, statusCounts] = await Promise.all([
			Promise.all(projectIds.map(async (projectId) => {
				return {
					projectId,
					run: (await runsService.readByQuery({
						filter: { project: { _eq: projectId } },
						sort: ["-date_created"],
						limit: 1
					}))?.[0] ?? null
				};
			})),
			runsService.readByQuery({
				filter: {
					project: { _in: projectIds },
					status: { _eq: "building" }
				},
				aggregate: { count: ["*"] }
			}),
			runsService.readByQuery({
				filter: { _and: [
					{ project: { _in: projectIds } },
					{ status: { _in: ["ready", "error"] } },
					{ date_created: { _gte: sinceDate.toISOString() } }
				] },
				aggregate: { count: ["*"] },
				group: ["status"]
			})
		]);
		const latestRunMap = new Map(latestRuns.map((r) => [r.projectId, r.run]));
		const countByStatus = (status) => Number(statusCounts.find((r) => r["status"] === status)?.["count"] ?? 0);
		this.syncProjectMetadataIfStale(provider, deployment).catch((err) => {
			useLogger().error(`Failed to sync project metadata for ${provider}: ${err}`);
		});
		return {
			projects: selectedProjects.map((p) => {
				const latestRun = latestRunMap.get(p.id);
				return {
					id: p.id,
					external_id: p.external_id,
					name: p.name,
					url: p.url,
					framework: p.framework,
					deployable: p.deployable,
					...latestRun && { latest_deployment: {
						status: latestRun.status,
						created_at: latestRun.started_at ?? latestRun.date_created,
						finished_at: latestRun.completed_at ?? null
					} }
				};
			}),
			stats: {
				active_deployments: Number(activeResult[0]?.["count"] ?? 0),
				successful_builds: countByStatus("ready"),
				failed_builds: countByStatus("error")
			}
		};
	}
	/**
	* Refresh project metadata (name, url, framework, deployable) if stale.
	*/
	async syncProjectMetadataIfStale(provider, deployment) {
		if (deployment.last_synced_at) {
			const lastSync = new Date(deployment.last_synced_at).getTime();
			if (Date.now() - lastSync < SYNC_THRESHOLD_MS) return;
		}
		useLogger().debug(`[metadata:${provider}] Syncing project metadata`);
		const projectsService = new DeploymentProjectsService({
			accountability: null,
			schema: this.schema
		});
		const driver = await this.getDriver(provider);
		const selectedProjects = await projectsService.readByQuery({
			filter: { deployment: { _eq: deployment.id } },
			limit: -1
		});
		const updates = await Promise.all(selectedProjects.map(async (p) => {
			const details = await driver.getProject(p.external_id);
			return {
				id: p.id,
				name: details.name,
				url: details.url ?? null,
				framework: details.framework ?? null,
				deployable: details.deployable
			};
		}));
		if (updates.length > 0) await projectsService.updateBatch(updates);
		await new DeploymentService({
			accountability: null,
			schema: this.schema
		}).updateOne(deployment.id, { last_synced_at: (/* @__PURE__ */ new Date()).toISOString() });
	}
	/**
	* Trigger a deployment for a project
	*/
	async triggerDeployment(provider, projectId, options) {
		const projectsService = new DeploymentProjectsService({
			accountability: this.accountability,
			schema: this.schema
		});
		const runsService = new DeploymentRunsService({
			accountability: this.accountability,
			schema: this.schema
		});
		const project = await projectsService.readOne(projectId);
		const result = await (await this.getDriver(provider)).triggerDeployment(project.external_id, {
			preview: options.preview,
			clearCache: options.clearCache
		});
		const runId = await runsService.createOne({
			project: projectId,
			external_id: result.deployment_id,
			target: options.preview ? "preview" : "production",
			status: result.status,
			started_at: result.created_at.toISOString(),
			...result.url ? { url: result.url } : {}
		});
		return runsService.readOne(runId);
	}
	/**
	* Cancel a deployment run
	*/
	async cancelDeployment(provider, runId) {
		const runsService = new DeploymentRunsService({
			accountability: this.accountability,
			schema: this.schema
		});
		const run = await runsService.readOne(runId);
		const status = await (await this.getDriver(provider)).cancelDeployment(run.external_id);
		await runsService.updateOne(runId, { status });
		return runsService.readOne(runId);
	}
	/**
	* Get a run with its logs from the provider
	*/
	async getRunWithLogs(provider, runId, since) {
		const run = await new DeploymentRunsService({
			accountability: this.accountability,
			schema: this.schema
		}).readOne(runId);
		const logs = await (await this.getDriver(provider)).getDeploymentLogs(run.external_id, since ? { since } : void 0);
		return {
			...run,
			logs
		};
	}
};

//#endregion
export { DeploymentService };