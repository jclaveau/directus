import { ItemsService } from "../../services/items.js";
import { Url } from "../../utils/url.js";
import "../../services/index.js";
import { coerceJsonFields } from "../tools/utils.js";
import { findMcpTool, getAllMcpTools } from "../tools/index.js";
import { DirectusTransport } from "./transport.js";
import { MCP_ACCESS_SCOPE, buildMcpWWWAuthenticateHeader, getMcpUrls } from "./utils.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { isObject, toArray } from "@directus/utils";
import { fromZodError } from "zod-validation-error";
import { z as z$1 } from "zod";
import { render, tokenize } from "micromustache";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode as ErrorCode$1, GetPromptRequestSchema, InitializedNotificationSchema, JSONRPCMessageSchema, ListPromptsRequestSchema, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

//#region src/ai/mcp/server.ts
var DirectusMCP = class {
	promptsCollection;
	systemPrompt;
	systemPromptEnabled;
	server;
	allowDeletes;
	constructor(options = {}) {
		this.promptsCollection = options.promptsCollection ?? null;
		this.systemPromptEnabled = options.systemPromptEnabled ?? true;
		this.systemPrompt = options.systemPrompt ?? null;
		this.allowDeletes = options.allowDeletes ?? false;
		this.server = new Server({
			name: "directus-mcp",
			version: "0.1.0"
		}, { capabilities: {
			tools: {},
			prompts: {}
		} });
	}
	/**
	* Send a 401 with WWW-Authenticate per RFC 6750 / RFC 9728.
	* Includes `resource_metadata` pointing to `/.well-known/oauth-protected-resource/mcp`
	* so clients can discover the authorization server from a 401 response.
	*/
	sendUnauthorized(res, error, status = 401) {
		const { metadataUrl } = getMcpUrls();
		res.set("WWW-Authenticate", buildMcpWWWAuthenticateHeader(metadataUrl, error)).set("Access-Control-Expose-Headers", "WWW-Authenticate").status(status).send();
	}
	/**
	* Handle an incoming MCP JSON-RPC request.
	*
	* OAuth-specific checks (when `accountability.oauth` is set):
	* - Transport restriction: token must be in Authorization header (RFC 6750), not cookie/query
	* - Scope check: must include mcp:access
	* - Audience check: must match the canonical MCP resource URL (PUBLIC_URL/mcp)
	*
	* Note: this function does not await lower-level logic; the actual response is an
	* asynchronous side effect happening after the function returns.
	*
	* @see sendUnauthorized for WWW-Authenticate format (RFC 9728 `resource_metadata` attribute)
	*/
	handleRequest(req, res) {
		const oauth = req.accountability?.oauth;
		if (!req.accountability?.user && !req.accountability?.role && req.accountability?.admin !== true) {
			this.sendUnauthorized(res);
			return;
		}
		if (oauth) {
			if (req.tokenSource !== "header") {
				this.sendUnauthorized(res, "invalid_request");
				return;
			}
			if (!oauth.scopes.includes(MCP_ACCESS_SCOPE)) {
				this.sendUnauthorized(res, "insufficient_scope", 403);
				return;
			}
			const { resourceUrl } = getMcpUrls();
			if (!oauth.aud.includes(resourceUrl)) {
				this.sendUnauthorized(res, "invalid_token");
				return;
			}
		}
		if (!req.accepts("application/json")) {
			res.status(405).send();
			return;
		}
		this.server.setNotificationHandler(InitializedNotificationSchema, () => {
			res.status(202).send();
		});
		this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
			const prompts = [];
			if (!this.promptsCollection) throw new McpError(1001, `A prompts collection must be set in settings`);
			const service = new ItemsService(this.promptsCollection, {
				accountability: req.accountability,
				schema: req.schema
			});
			try {
				const promptList = await service.readByQuery({ fields: [
					"name",
					"description",
					"system_prompt",
					"messages"
				] });
				for (const prompt of promptList) {
					const args = [];
					if (prompt.system_prompt) for (const varName of tokenize(prompt.system_prompt).varNames) args.push({
						name: varName,
						description: `Value for ${varName}`,
						required: false
					});
					for (const message of prompt.messages || []) for (const varName of tokenize(message.text).varNames) args.push({
						name: varName,
						description: `Value for ${varName}`,
						required: false
					});
					prompts.push({
						name: prompt.name,
						description: prompt.description,
						arguments: args
					});
				}
				return { prompts };
			} catch (error) {
				return this.toExecutionError(error);
			}
		});
		this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
			if (!this.promptsCollection) throw new McpError(1001, `A prompts collection must be set in settings`);
			const service = new ItemsService(this.promptsCollection, {
				accountability: req.accountability,
				schema: req.schema
			});
			const { name: promptName, arguments: args } = request.params;
			const prompt = (await service.readByQuery({
				fields: [
					"description",
					"system_prompt",
					"messages"
				],
				filter: { name: { _eq: promptName } }
			}))[0];
			if (!prompt) throw new McpError(ErrorCode$1.InvalidParams, `Invalid prompt "${promptName}"`);
			const messages = [];
			if (prompt.system_prompt) messages.push({
				role: "assistant",
				content: {
					type: "text",
					text: render(prompt.system_prompt, args)
				}
			});
			(prompt.messages || []).forEach((message) => {
				if (!message.role || !message.text) return;
				messages.push({
					role: message.role,
					content: {
						type: "text",
						text: render(message.text, args)
					}
				});
			});
			return this.toPromptResponse({
				messages,
				description: prompt.description
			});
		});
		this.server.setRequestHandler(ListToolsRequestSchema, () => {
			const tools = [];
			for (const tool of getAllMcpTools()) {
				if (req.accountability?.admin !== true && tool.admin === true) continue;
				if (tool.name === "system-prompt" && this.systemPromptEnabled === false) continue;
				tools.push({
					name: tool.name,
					description: tool.description,
					inputSchema: z$1.toJSONSchema(tool.inputSchema),
					annotations: tool.annotations
				});
			}
			return { tools };
		});
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const tool = findMcpTool(request.params.name);
			try {
				if (!tool || tool.name === "system-prompt" && this.systemPromptEnabled === false) throw new InvalidPayloadError({ reason: `"${request.params.name}" doesn't exist in the toolset` });
				if (req.accountability?.admin !== true && tool.admin === true) throw new ForbiddenError({ reason: "You must be an admin to access this tool" });
				if (tool.name === "system-prompt") request.params.arguments = { promptOverride: this.systemPrompt };
				const coercedArgs = request.params.arguments ? coerceJsonFields(request.params.arguments) : request.params.arguments;
				const { error, data: args } = tool.validateSchema?.safeParse(coercedArgs) ?? { data: coercedArgs };
				if (error) throw new InvalidPayloadError({ reason: fromZodError(error).message });
				if (!isObject(args)) throw new InvalidPayloadError({ reason: "\"arguments\" must be an object" });
				if (this.allowDeletes === false && "action" in args && args["action"] === "delete") throw new InvalidPayloadError({ reason: "Delete actions are disabled" });
				const result = await tool.handler({
					args,
					schema: req.schema,
					accountability: req.accountability
				});
				const data = toArray(result?.data);
				if ("action" in args && [
					"create",
					"update",
					"read",
					"import"
				].includes(args["action"]) && result?.data && data.length === 1) result.url = this.buildURL(tool, args, data[0]);
				return this.toToolResponse(result);
			} catch (error) {
				return this.toExecutionError(error);
			}
		});
		const transport = new DirectusTransport(res);
		this.server.connect(transport);
		try {
			const parsedMessage = JSONRPCMessageSchema.parse(req.body);
			transport.onmessage?.(parsedMessage);
		} catch (error) {
			transport.onerror?.(error);
			throw error;
		}
	}
	buildURL(tool, input, data) {
		const env = useEnv();
		if (!env["PUBLIC_URL"]) return;
		if (!tool.endpoint) return;
		const path = tool.endpoint({
			input,
			data
		});
		if (!path) return;
		return new Url(env["PUBLIC_URL"]).addPath("admin", ...path).toString();
	}
	toPromptResponse(result) {
		const response = { messages: result.messages };
		if (result.description) response.description = result.description;
		return response;
	}
	toToolResponse(result) {
		const response = { content: [] };
		if (!result || typeof result.data === "undefined" || result.data === null) return response;
		if (result.type === "text") response.content.push({
			type: "text",
			text: JSON.stringify({
				raw: result.data,
				url: result.url
			})
		});
		else response.content.push(result);
		return response;
	}
	toExecutionError(err) {
		const errors = [];
		const receivedErrors = Array.isArray(err) ? err : [err];
		for (const error of receivedErrors) if (isDirectusError(error)) errors.push({
			error: error.message || "Unknown error",
			code: error.code
		});
		else {
			let message = "An unknown error occurred.";
			let code;
			if (error instanceof Error) {
				message = error.message;
				code = "code" in error ? String(error.code) : void 0;
			} else if (typeof error === "object" && error !== null) {
				message = "message" in error ? String(error.message) : message;
				code = "code" in error ? String(error.code) : void 0;
			} else if (typeof error === "string") message = error;
			errors.push({
				error: message,
				...code && { code }
			});
		}
		return {
			isError: true,
			content: [{
				type: "text",
				text: JSON.stringify(errors)
			}]
		};
	}
};

//#endregion
export { DirectusMCP };