import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { FlowsService } from "../../../services/flows.js";
import { getFlowManager } from "../../../flows.js";
import { TriggerFlowInputSchema, TriggerFlowValidateSchema } from "../schema.js";
import { InvalidPayloadError } from "@directus/errors";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/trigger-flow/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const triggerFlow = defineTool({
	name: "trigger-flow",
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Trigger Flow" },
	inputSchema: TriggerFlowInputSchema,
	validateSchema: TriggerFlowValidateSchema,
	async handler({ args, schema, accountability }) {
		/**
		* Collection and Required selection are validated by the server.
		* Required fields is an additional validation we do.
		*/
		const requiredFields = ((await new FlowsService({
			schema,
			accountability
		}).readOne(args.id, {
			filter: {
				status: { _eq: "active" },
				trigger: { _eq: "manual" }
			},
			fields: ["options"]
		})).options?.["fields"] ?? []).filter((field) => field.meta?.required).map((field) => field.field);
		for (const fieldName of requiredFields) if (!args.data || !(fieldName in args.data)) throw new InvalidPayloadError({ reason: `Required field "${fieldName}" is missing` });
		const { result } = await getFlowManager().runWebhookFlow(`POST-${args.id}`, {
			path: `/trigger/${args.id}`,
			query: args.query ?? {},
			method: "POST",
			body: {
				collection: args.collection,
				keys: args.keys,
				...args.data ?? {}
			},
			headers: args.headers ?? {}
		}, {
			accountability,
			schema
		});
		return {
			type: "text",
			data: result
		};
	}
});

//#endregion
export { triggerFlow };