import { DeploymentDriver } from "../deployment.js";
import { HitRateLimitError, InvalidCredentialsError, ServiceUnavailableError } from "@directus/errors";
import { createHmac, timingSafeEqual } from "node:crypto";
import pLimit from "p-limit";

//#region src/deployment/drivers/vercel.ts
const VERCEL_WEBHOOK_EVENTS = [
	"deployment.created",
	"deployment.succeeded",
	"deployment.error",
	"deployment.canceled"
];
var VercelDriver = class VercelDriver extends DeploymentDriver {
	static API_URL = "https://api.vercel.com";
	requestLimit = pLimit(5);
	constructor(credentials, options = {}) {
		super(credentials, options);
	}
	/**
	* Make authenticated request with retry on rate limit and concurrency control
	*/
	async request(endpoint, options = {}, retryCount = 0) {
		return this.requestLimit(async () => {
			const response = await this.axiosRequest(VercelDriver.API_URL, endpoint, {
				...options,
				headers: {
					Authorization: `Bearer ${this.credentials.access_token}`,
					"Content-Type": "application/json",
					...options.headers ?? {}
				},
				params: {
					...this.options.team_id ? { teamId: this.options.team_id } : {},
					...options.params ?? {}
				}
			});
			if (response.status === 429) {
				const resetAt = parseInt(response.headers["x-ratelimit-reset"] || "0");
				const limit = parseInt(response.headers["x-ratelimit-limit"] || "0");
				if (retryCount < 3) {
					const waitTime = resetAt > 0 ? Math.max(resetAt * 1e3 - Date.now(), 1e3) : 1e3 * (retryCount + 1);
					await new Promise((resolve) => setTimeout(resolve, waitTime));
					return this.request(endpoint, options, retryCount + 1);
				}
				throw new HitRateLimitError({
					limit,
					reset: new Date(resetAt > 0 ? resetAt * 1e3 : Date.now())
				});
			}
			const body = response.data;
			if (response.status >= 400) {
				const message = typeof body === "object" && body !== null && "error" in body ? body.error?.message || `Vercel API error: ${response.status}` : `Vercel API error: ${response.status}`;
				if (response.status === 401 || response.status === 403) throw new InvalidCredentialsError();
				throw new ServiceUnavailableError({
					service: "vercel",
					reason: message
				});
			}
			return body;
		});
	}
	mapStatus(vercelStatus) {
		const normalized = vercelStatus?.toLowerCase();
		switch (normalized) {
			case "building":
			case "error":
			case "canceled":
			case "ready": return normalized;
			case "queued":
			case "initializing":
			case "analyzing":
			case "deploying":
			default: return "building";
		}
	}
	async testConnection() {
		return await this.request("/v9/projects", { params: { limit: "1" } });
	}
	mapProjectBase(project) {
		const result = {
			id: project.id,
			name: project.name,
			deployable: Boolean(project.link?.type)
		};
		if (project.framework) result.framework = project.framework;
		return result;
	}
	async listProjects() {
		const allProjects = [];
		let until;
		do {
			const response = await this.request("/v9/projects", { params: {
				limit: "100",
				...until ? { until } : {}
			} });
			allProjects.push(...response.projects.map((project) => this.mapProjectBase(project)));
			until = response.pagination?.next ? String(response.pagination.next) : void 0;
		} while (until);
		return allProjects;
	}
	async getProject(projectId) {
		const project = await this.request(`/v9/projects/${projectId}`);
		const result = this.mapProjectBase(project);
		const production = project.targets?.production;
		if (production?.alias?.[0]) result.url = `https://${production.alias[0]}`;
		if (production?.readyState && production.createdAt) result.latest_deployment = {
			status: this.mapStatus(production.readyState),
			created_at: new Date(production.createdAt),
			...production.readyAt && { finished_at: new Date(production.readyAt) }
		};
		if (project.createdAt) result.created_at = new Date(project.createdAt);
		if (project.updatedAt) result.updated_at = new Date(project.updatedAt);
		return result;
	}
	async listDeployments(projectId, limit = 20) {
		const url = `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`;
		return (await this.request(url)).deployments.map((deployment) => {
			const result = {
				id: deployment.uid,
				project_id: deployment.projectId ?? projectId,
				status: this.mapStatus(deployment.state),
				created_at: new Date(deployment.createdAt)
			};
			if (deployment.url) result.url = `https://${deployment.url}`;
			if (deployment.ready) result.finished_at = new Date(deployment.ready);
			return result;
		});
	}
	async getDeployment(deploymentId) {
		const deployment = await this.request(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
		const result = {
			id: deployment.id,
			project_id: deployment.projectId ?? "",
			status: this.mapStatus(deployment.status || deployment.state),
			created_at: new Date(deployment.createdAt)
		};
		if (deployment.url) result.url = `https://${deployment.url}`;
		if (deployment.ready) result.finished_at = new Date(deployment.ready);
		return result;
	}
	async triggerDeployment(projectId, options) {
		const project = await this.request(`/v9/projects/${projectId}`);
		const body = {
			name: project.name,
			project: projectId
		};
		if (!options?.preview) body["target"] = "production";
		if (project.link?.type) body["gitSource"] = {
			type: project.link.type,
			ref: project.link.productionBranch,
			repoId: project.link.repoId
		};
		const response = await this.request("/v13/deployments", {
			method: "POST",
			body: JSON.stringify(body),
			...options?.clearCache && { params: { forceNew: "1" } }
		});
		const triggerResult = {
			deployment_id: response.id,
			status: this.mapStatus(response.status),
			created_at: new Date(response.createdAt)
		};
		if (response.url) triggerResult.url = `https://${response.url}`;
		return triggerResult;
	}
	async cancelDeployment(deploymentId) {
		try {
			await this.request(`/v12/deployments/${encodeURIComponent(deploymentId)}/cancel`, { method: "PATCH" });
			return "canceled";
		} catch {
			const details = await this.getDeployment(deploymentId);
			if (details.status !== "building") return details.status;
			throw new ServiceUnavailableError({
				service: "vercel",
				reason: `Could not cancel the deployment: ${deploymentId}`
			});
		}
	}
	async getDeploymentLogs(deploymentId, options) {
		let url = `/v3/deployments/${encodeURIComponent(deploymentId)}/events`;
		if (options?.since) {
			const sinceMs = options.since.getTime();
			url += `?since=${sinceMs}`;
		}
		const response = await this.request(url);
		const mapEventType = (type) => {
			if (type === "stderr") return "stderr";
			if (type === "command") return "info";
			return "stdout";
		};
		return response.filter((event) => event.type === "stdout" || event.type === "stderr" || event.type === "command").map((event) => ({
			timestamp: new Date(event.created),
			type: mapEventType(event.type),
			message: event.text || event.payload?.text || ""
		}));
	}
	async registerWebhook(webhookUrl, projectIds) {
		const response = await this.request("/v1/webhooks", {
			method: "POST",
			body: JSON.stringify({
				url: webhookUrl,
				events: VERCEL_WEBHOOK_EVENTS,
				projectIds
			})
		});
		return {
			webhook_ids: [response.id],
			webhook_secret: response.secret
		};
	}
	async unregisterWebhook(webhookIds) {
		for (const id of webhookIds) await this.request(`/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
	}
	verifyAndParseWebhook(rawBody, headers, webhookSecret) {
		const signature = headers["x-vercel-signature"];
		if (!signature || typeof signature !== "string") return null;
		const expected = createHmac("sha1", webhookSecret).update(rawBody).digest("hex");
		if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
		const body = JSON.parse(rawBody.toString("utf-8"));
		if (!VERCEL_WEBHOOK_EVENTS.includes(body.type)) return null;
		return {
			type: body.type,
			provider: "vercel",
			project_external_id: body.payload.project.id,
			deployment_external_id: body.payload.deployment.id,
			status: {
				"deployment.created": "building",
				"deployment.succeeded": "ready",
				"deployment.error": "error",
				"deployment.canceled": "canceled"
			}[body.type] ?? "building",
			...body.payload.deployment.url ? { url: `https://${body.payload.deployment.url}` } : {},
			...body.payload.target ? { target: body.payload.target } : {},
			timestamp: new Date(body.createdAt),
			raw: body
		};
	}
};

//#endregion
export { VercelDriver };