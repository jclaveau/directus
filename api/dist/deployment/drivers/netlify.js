import { useLogger } from "../../logger/index.js";
import { DeploymentDriver } from "../deployment.js";
import { InvalidCredentialsError, ServiceUnavailableError } from "@directus/errors";
import { isNumber } from "lodash-es";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NetlifyAPI } from "@netlify/api";

//#region src/deployment/drivers/netlify.ts
const WS_CONNECTIONS = /* @__PURE__ */ new Map();
const WS_IDLE_TIMEOUT = 6e4;
const WS_CONNECTION_TIMEOUT = 1e4;
const ANSI_REGEX = /[\x1b]\[[0-9;]*m/g;
const WS_URL = "wss://socketeer.services.netlify.com/build/logs";
const NETLIFY_WEBHOOK_EVENTS = [
	"deploy_created",
	"deploy_building",
	"deploy_failed",
	"deploy_succeeded"
];
const STATE_TO_EVENT = {
	building: {
		type: "deployment.created",
		status: "building"
	},
	ready: {
		type: "deployment.succeeded",
		status: "ready"
	},
	error: {
		type: "deployment.error",
		status: "error"
	}
};
var NetlifyDriver = class extends DeploymentDriver {
	api;
	constructor(credentials, options = {}) {
		super(credentials, options);
		this.api = new NetlifyAPI(this.credentials.access_token);
	}
	async handleApiError(cb) {
		try {
			return await cb(this.api);
		} catch (error) {
			if (error instanceof Error && "status" in error && isNumber(error.status) && error.status >= 400) {
				if (error.status === 401 || error.status === 403) throw new InvalidCredentialsError();
				throw new ServiceUnavailableError({
					service: "netlify",
					reason: "Netlify API error: " + error.message
				});
			}
			throw error;
		}
	}
	mapStatus(netlifyState) {
		switch (netlifyState?.toLowerCase()) {
			case "ready": return "ready";
			case "error": return "error";
			case "canceled": return "canceled";
			default: return "building";
		}
	}
	async testConnection() {
		await this.handleApiError((api) => api.listSites({ per_page: 1 }));
	}
	mapSiteBase(site) {
		const result = {
			id: site.id,
			name: site.name,
			deployable: Boolean(site.build_settings?.provider && site.build_settings?.repo_url)
		};
		if (site.custom_domain) result.url = `https://${site.custom_domain}`;
		else if (site.ssl_url) result.url = site.ssl_url;
		else if (site.url) result.url = site.url;
		return result;
	}
	async listProjects() {
		const allSites = [];
		const perPage = 100;
		let hasMore = true;
		for (let page = 1; hasMore; page++) {
			const params = {
				per_page: String(perPage),
				page: String(page)
			};
			const response = await this.handleApiError((api) => {
				return this.options.account_slug ? api.listSitesForAccount({
					account_slug: this.options.account_slug,
					...params
				}) : api.listSites(params);
			});
			allSites.push(...response);
			hasMore = response.length >= perPage;
		}
		return allSites.map((site) => this.mapSiteBase(site));
	}
	async getProject(projectId) {
		const site = await this.handleApiError((api) => api.getSite({ siteId: projectId }));
		const result = this.mapSiteBase(site);
		if (site.published_deploy) {
			const deploy = site.published_deploy;
			if (deploy.state && deploy.created_at) result.latest_deployment = {
				status: this.mapStatus(deploy.state),
				created_at: new Date(deploy.created_at),
				...deploy.published_at && { finished_at: new Date(deploy.published_at) }
			};
		}
		if (site.created_at) result.created_at = new Date(site.created_at);
		if (site.updated_at) result.updated_at = new Date(site.updated_at);
		return result;
	}
	mapDeployUrl(deploy) {
		return deploy["ssl_url"] ?? deploy["deploy_ssl_url"] ?? deploy["deploy_url"] ?? deploy["url"];
	}
	async listDeployments(projectId, limit = 20) {
		return (await this.handleApiError((api) => api.listSiteDeploys({
			site_id: projectId,
			per_page: limit
		}))).map((deploy) => {
			const result = {
				id: deploy.id,
				project_id: deploy.site_id,
				status: this.mapStatus(deploy.state),
				created_at: new Date(deploy.created_at)
			};
			const url = this.mapDeployUrl(deploy);
			if (url) result.url = url;
			if (deploy.published_at) result.finished_at = new Date(deploy.published_at);
			if (deploy.error_message) result.error_message = deploy.error_message;
			return result;
		});
	}
	async getDeployment(deploymentId) {
		const deploy = await this.handleApiError((api) => api.getDeploy({ deployId: deploymentId }));
		const result = {
			id: deploy.id,
			project_id: deploy.site_id,
			status: this.mapStatus(deploy.state),
			created_at: new Date(deploy.created_at)
		};
		const url = this.mapDeployUrl(deploy);
		if (url) result.url = url;
		if (deploy.published_at) result.finished_at = new Date(deploy.published_at);
		if (deploy.error_message) result.error_message = deploy.error_message;
		return result;
	}
	async triggerDeployment(projectId, options) {
		const buildResponse = await this.handleApiError((api) => api.createSiteBuild({
			site_id: projectId,
			clear_cache: options?.clearCache || false
		}));
		const deployState = await this.handleApiError((api) => api.getDeploy({ deployId: buildResponse.deploy_id }));
		return {
			deployment_id: buildResponse.deploy_id,
			status: this.mapStatus(deployState.state),
			created_at: new Date(deployState.created_at)
		};
	}
	async cancelDeployment(deploymentId) {
		try {
			await this.handleApiError((api) => api.cancelSiteDeploy({ deployId: deploymentId }));
			this.closeWsConnection(deploymentId);
			return "canceled";
		} catch {
			const details = await this.getDeployment(deploymentId);
			if (details.status !== "building") {
				this.closeWsConnection(deploymentId);
				return details.status;
			}
			throw new ServiceUnavailableError({
				service: "netlify",
				reason: `Could not cancel the deployment: ${deploymentId}`
			});
		}
	}
	closeWsConnection(deploymentId, remove = true) {
		const connection = WS_CONNECTIONS.get(deploymentId);
		if (!connection) return;
		connection.ws.close();
		if (remove) WS_CONNECTIONS.delete(deploymentId);
	}
	setupWsIdleTimeout(connection) {
		if (connection.idleTimeout) clearTimeout(connection.idleTimeout);
		connection.idleTimeout = setTimeout(() => {
			this.closeWsConnection(connection.deploymentId);
		}, WS_IDLE_TIMEOUT);
	}
	setupWsConnectionTimeout(connection, reject) {
		if (connection.connectionTimeout) clearTimeout(connection.connectionTimeout);
		connection.connectionTimeout = setTimeout(() => {
			this.closeWsConnection(connection.deploymentId);
			reject(new ServiceUnavailableError({
				service: "netlify",
				reason: "WebSocket connection timeout"
			}));
		}, WS_CONNECTION_TIMEOUT);
	}
	getWsConnection(deploymentId) {
		return new Promise((resolve, reject) => {
			const existingConnection = WS_CONNECTIONS.get(deploymentId);
			if (existingConnection) {
				this.setupWsIdleTimeout(existingConnection);
				return resolve(existingConnection);
			}
			let resolveCompleted;
			const completed = new Promise((res) => {
				resolveCompleted = res;
			});
			const connection = {
				ws: new WebSocket(WS_URL),
				logs: [],
				deploymentId,
				completed,
				resolveCompleted
			};
			this.setupWsConnectionTimeout(connection, reject);
			connection.ws.addEventListener("open", () => {
				if (connection.connectionTimeout) {
					clearTimeout(connection.connectionTimeout);
					connection.connectionTimeout = void 0;
				}
				this.setupWsIdleTimeout(connection);
				const payload = JSON.stringify({
					deploy_id: deploymentId,
					access_token: this.credentials.access_token
				});
				connection.ws.send(payload);
				resolve(connection);
				WS_CONNECTIONS.set(deploymentId, connection);
			});
			connection.ws.addEventListener("message", (event) => {
				const data = JSON.parse(event.data);
				const cleanMessage = data.message.replace(/\r/g, "").replace(ANSI_REGEX, "");
				let logType = "stdout";
				if (data.type === "report") logType = cleanMessage.includes("Failing build") ? "stderr" : "info";
				connection.logs.push({
					timestamp: new Date(data.ts),
					type: logType,
					message: cleanMessage
				});
				if (data.type === "report") {
					connection.resolveCompleted();
					this.closeWsConnection(deploymentId, false);
				}
			});
			connection.ws.addEventListener("error", () => {
				this.closeWsConnection(deploymentId);
				reject(new ServiceUnavailableError({
					service: "netlify",
					reason: "WebSocket connection error"
				}));
			});
			connection.ws.addEventListener("close", () => {
				if (connection.connectionTimeout) clearTimeout(connection.connectionTimeout);
			});
		});
	}
	async registerWebhook(webhookUrl, projectIds) {
		const logger = useLogger();
		const secret = randomBytes(32).toString("hex");
		const hookIds = [];
		const signedUrl = `${webhookUrl}?token=${secret}`;
		for (const siteId of projectIds) await this.cleanupStaleHooks(siteId, webhookUrl);
		for (const siteId of projectIds) for (const event of NETLIFY_WEBHOOK_EVENTS) {
			const hook = await this.handleApiError((api) => api.createHookBySiteId({
				site_id: siteId,
				body: {
					type: "url",
					event,
					data: { url: signedUrl }
				}
			}));
			logger.debug(`[webhook:netlify] Created hook ${hook.id} for event ${event}`);
			hookIds.push(hook.id);
		}
		return {
			webhook_ids: hookIds,
			webhook_secret: secret
		};
	}
	async cleanupStaleHooks(siteId, webhookUrl) {
		const logger = useLogger();
		const staleHooks = (await this.handleApiError((api) => api.listHooksBySiteId({ site_id: siteId }))).filter((h) => h.data?.url?.startsWith(webhookUrl));
		if (staleHooks.length > 0) {
			logger.debug(`[webhook:netlify] Cleaning up ${staleHooks.length} stale hook(s) for site ${siteId}`);
			await Promise.allSettled(staleHooks.map((h) => this.api.deleteHook({ hook_id: h.id })));
		}
	}
	async unregisterWebhook(webhookIds) {
		await Promise.allSettled(webhookIds.map((id) => this.api.deleteHook({ hook_id: id })));
	}
	verifyAndParseWebhook(rawBody, headers, webhookSecret) {
		const logger = useLogger();
		const token = headers["x-webhook-token"];
		if (!token || typeof token !== "string") {
			logger.warn(`[webhook:netlify] Missing webhook token`);
			return null;
		}
		const tokenBuf = Buffer.from(token);
		const secretBuf = Buffer.from(webhookSecret);
		if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
			logger.warn(`[webhook:netlify] Token mismatch`);
			return null;
		}
		const deploy = JSON.parse(rawBody.toString("utf-8"));
		const mapping = STATE_TO_EVENT[this.mapStatus(deploy.state)];
		if (!mapping) return null;
		const url = deploy.ssl_url || deploy.deploy_ssl_url || deploy.url;
		const timestamp = deploy.published_at || deploy.updated_at || deploy.created_at;
		return {
			type: mapping.type,
			provider: "netlify",
			project_external_id: deploy.site_id,
			deployment_external_id: deploy.id,
			status: mapping.status,
			...url ? { url } : {},
			...deploy.context ? { target: deploy.context } : {},
			timestamp: new Date(timestamp),
			raw: deploy
		};
	}
	async getDeploymentLogs(deploymentId, options) {
		const deploy = await this.handleApiError((api) => api.getDeploy({ deployId: deploymentId }));
		const connection = await this.getWsConnection(deploymentId);
		if (this.mapStatus(deploy.state) !== "building") await connection.completed;
		if (options?.since) return connection.logs.filter((log) => log.timestamp >= options.since);
		return connection.logs;
	}
};

//#endregion
export { NetlifyDriver };