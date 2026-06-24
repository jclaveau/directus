import { zodJsonSchema7Parser } from "../utils/zod-jsonschema7-parser.js";
import { ProviderAnthropic, ProviderGoogle, ProviderOpenAi, ProviderOpenAiCompatible } from "./providers.js";
import "ai";
import { z as z$1 } from "zod";

//#region src/ai/chat/models/chat-request.ts
const ChatRequestTool = z$1.union([z$1.string(), z$1.object({
	name: z$1.string(),
	description: z$1.string(),
	inputSchema: z$1.custom(zodJsonSchema7Parser, { message: "Invalid JSON schema" })
})]);
const ToolApprovalMode = z$1.enum([
	"always",
	"ask",
	"disabled"
]);
const ItemContextData = z$1.object({
	collection: z$1.string(),
	key: z$1.union([z$1.string(), z$1.number()])
});
const VisualElementContextData = z$1.object({
	key: z$1.string(),
	collection: z$1.string(),
	item: z$1.union([z$1.string(), z$1.number()]),
	fields: z$1.array(z$1.string()).optional(),
	rect: z$1.object({
		top: z$1.number(),
		left: z$1.number(),
		width: z$1.number(),
		height: z$1.number()
	}).optional()
});
const PromptContextData = z$1.object({
	text: z$1.string(),
	prompt: z$1.record(z$1.string(), z$1.unknown()),
	values: z$1.record(z$1.string(), z$1.string())
});
const ContextAttachment = z$1.discriminatedUnion("type", [
	z$1.object({
		type: z$1.literal("item"),
		display: z$1.string(),
		data: ItemContextData,
		snapshot: z$1.record(z$1.string(), z$1.unknown())
	}),
	z$1.object({
		type: z$1.literal("visual-element"),
		display: z$1.string(),
		data: VisualElementContextData,
		snapshot: z$1.record(z$1.string(), z$1.unknown())
	}),
	z$1.object({
		type: z$1.literal("prompt"),
		display: z$1.string(),
		data: PromptContextData,
		snapshot: z$1.record(z$1.string(), z$1.unknown())
	})
]);
const PageContext = z$1.object({
	path: z$1.string(),
	collection: z$1.string().optional(),
	item: z$1.union([z$1.string(), z$1.number()]).optional(),
	module: z$1.string().optional()
});
const ChatContext = z$1.object({
	attachments: z$1.array(ContextAttachment).max(10).optional(),
	page: PageContext.optional()
});
const ChatRequest = z$1.intersection(z$1.discriminatedUnion("provider", [
	ProviderOpenAi,
	ProviderAnthropic,
	ProviderGoogle,
	ProviderOpenAiCompatible
]), z$1.object({
	tools: z$1.array(ChatRequestTool),
	messages: z$1.array(z$1.looseObject({})),
	toolApprovals: z$1.record(z$1.string(), ToolApprovalMode).optional(),
	context: ChatContext.optional()
}));

//#endregion
export { ChatContext, ChatRequest, ChatRequestTool, ContextAttachment, PageContext, ToolApprovalMode };