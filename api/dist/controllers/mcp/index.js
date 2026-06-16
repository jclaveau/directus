import async_handler_default from "../../utils/async-handler.js";
import { SettingsService } from "../../services/settings.js";
import is_locked_default from "../../middleware/is-locked.js";
import { DirectusMCP } from "../../ai/mcp/server.js";
import "../../ai/mcp/index.js";
import { useEnv } from "@directus/env";
import { ForbiddenError } from "@directus/errors";
import { toBoolean } from "@directus/utils";
import { Router } from "express";

//#region src/controllers/mcp/index.ts
const router = Router();
router.use(is_locked_default("mcp"));
const mcpHandler = async_handler_default(async (req, res) => {
	const env = useEnv();
	const { mcp_enabled, mcp_oauth_enabled, mcp_allow_deletes, mcp_prompts_collection, mcp_system_prompt, mcp_system_prompt_enabled } = await new SettingsService({ schema: req.schema }).readSingleton({ fields: [
		"mcp_enabled",
		"mcp_oauth_enabled",
		"mcp_allow_deletes",
		"mcp_prompts_collection",
		"mcp_system_prompt",
		"mcp_system_prompt_enabled"
	] });
	if (!mcp_enabled) throw new ForbiddenError({ reason: "MCP must be enabled" });
	if (req.accountability?.oauth && (toBoolean(env["MCP_OAUTH_ENABLED"]) !== true || toBoolean(mcp_oauth_enabled) !== true)) throw new ForbiddenError({ reason: "MCP OAuth must be enabled" });
	new DirectusMCP({
		promptsCollection: mcp_prompts_collection,
		allowDeletes: mcp_allow_deletes,
		systemPromptEnabled: mcp_system_prompt_enabled,
		systemPrompt: mcp_system_prompt
	}).handleRequest(req, res);
});
router.get("/", mcpHandler);
router.post("/", mcpHandler);
var mcp_default = router;

//#endregion
export { mcp_default as default };