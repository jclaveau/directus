import database_default from "../../../database/index.js";
import { getSchema } from "../../../utils/get-schema.js";
import { FlowsService } from "../../../services/flows.js";

//#region src/license/entitlements/lib/flows.ts
async function getActiveFlows(opts) {
	const knex = opts?.knex ?? database_default();
	return await new FlowsService({
		schema: await getSchema({ database: knex }),
		knex
	}).readByQuery({
		fields: ["id", "name"],
		filter: { status: { _eq: "active" } },
		limit: -1
	});
}
async function countActiveFlows(opts) {
	return (await getActiveFlows(opts)).length;
}
async function resolveFlows(flows, ctx) {
	const flowsService = new FlowsService({
		schema: await getSchema(),
		accountability: ctx?.accountability
	});
	await Promise.allSettled(flows.map((flow_id) => flowsService.updateOne(flow_id, { status: "inactive" })));
}

//#endregion
export { countActiveFlows, getActiveFlows, resolveFlows };