import { ItemsService } from "./items.js";

//#region src/services/deployment-runs.ts
var DeploymentRunsService = class extends ItemsService {
	constructor(options) {
		super("directus_deployment_runs", options);
	}
	/**
	* Process a webhook event: create or update a run based on the event data.
	* Returns the run ID.
	*/
	async processWebhookEvent(projectId, event) {
		const existingRuns = await this.readByQuery({
			filter: {
				project: { _eq: projectId },
				external_id: { _eq: event.deployment_external_id }
			},
			limit: 1
		});
		const isTerminal = event.type === "deployment.succeeded" || event.type === "deployment.error" || event.type === "deployment.canceled";
		if (existingRuns && existingRuns.length > 0) {
			const existingRun = existingRuns[0];
			await this.updateOne(existingRun.id, {
				status: event.status,
				...event.url ? { url: event.url } : {},
				...event.type === "deployment.created" && !existingRun.started_at ? { started_at: event.timestamp.toISOString() } : {},
				...isTerminal ? { completed_at: event.timestamp.toISOString() } : {}
			});
			return existingRun.id;
		}
		return await this.createOne({
			project: projectId,
			external_id: event.deployment_external_id,
			target: event.target || "production",
			status: event.status,
			...event.url ? { url: event.url } : {},
			started_at: event.type === "deployment.created" ? event.timestamp.toISOString() : null,
			...isTerminal ? { completed_at: event.timestamp.toISOString() } : {}
		});
	}
	/**
	* Get run stats for a project within a date range
	*/
	async getStats(projectId, sinceDate) {
		const dateFilter = { _and: [{ project: { _eq: projectId } }, { date_created: { _gte: sinceDate } }] };
		const [countResult, completedRuns, statusCounts] = await Promise.all([
			this.readByQuery({
				filter: dateFilter,
				aggregate: { count: ["*"] }
			}),
			this.readByQuery({
				filter: { _and: [
					{ project: { _eq: projectId } },
					{ date_created: { _gte: sinceDate } },
					{ started_at: { _nnull: true } },
					{ completed_at: { _nnull: true } }
				] },
				fields: ["started_at", "completed_at"],
				limit: -1
			}),
			this.readByQuery({
				filter: { _and: [
					{ project: { _eq: projectId } },
					{ date_created: { _gte: sinceDate } },
					{ status: { _in: ["ready", "error"] } }
				] },
				aggregate: { count: ["*"] },
				group: ["status"]
			})
		]);
		let averageBuildTime = null;
		if (completedRuns.length > 0) {
			const durations = completedRuns.map((r) => new Date(r.completed_at).getTime() - new Date(r.started_at).getTime());
			averageBuildTime = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
		}
		const statusMap = new Map(statusCounts.map((r) => [r.status, Number(r.count)]));
		return {
			total_deployments: Number(countResult[0]?.["count"] ?? 0),
			average_build_time: averageBuildTime,
			failed_builds: statusMap.get("error") ?? 0,
			successful_builds: statusMap.get("ready") ?? 0
		};
	}
};

//#endregion
export { DeploymentRunsService };