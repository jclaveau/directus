import "../../../packages/types/dist/index.js";
import { coerceJsonFields } from "../../tools/utils.js";
import { ALL_TOOLS } from "../../tools/index.js";
import { InvalidPayloadError } from "@directus/errors";
import { jsonSchema, tool, zodSchema } from "ai";
import { fromZodError } from "zod-validation-error";

//#region src/ai/chat/utils/chat-request-tool-to-ai-sdk-tool.ts
const chatRequestToolToAiSdkTool = ({ chatRequestTool, accountability, schema, toolApprovals }) => {
	if (typeof chatRequestTool === "string") {
		const directusTool = ALL_TOOLS.find(({ name }) => name === chatRequestTool);
		if (!directusTool) throw new InvalidPayloadError({ reason: `Tool by name "${chatRequestTool}" does not exist` });
		const needsApproval = (toolApprovals?.[chatRequestTool] ?? "ask") !== "always";
		const inputSchema = zodSchema(directusTool.inputSchema);
		return tool({
			description: directusTool.description,
			inputSchema,
			needsApproval,
			execute: async (rawArgs) => {
				const coercedArgs = coerceJsonFields(rawArgs);
				const { error, data: args } = directusTool.validateSchema?.safeParse(coercedArgs) ?? { data: coercedArgs };
				if (error) throw new InvalidPayloadError({ reason: fromZodError(error).message });
				return directusTool.handler({
					args,
					accountability,
					schema
				});
			}
		});
	}
	return tool({
		description: chatRequestTool.description,
		inputSchema: jsonSchema(chatRequestTool.inputSchema)
	});
};

//#endregion
export { chatRequestToolToAiSdkTool };