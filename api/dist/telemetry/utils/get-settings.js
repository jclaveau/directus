import { getSchema } from "../../utils/get-schema.js";
import { SettingsService } from "../../services/settings.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/telemetry/utils/get-settings.ts
const getSettings = async (db) => {
	const env = useEnv();
	const settings = await new SettingsService({
		knex: db,
		schema: await getSchema({ database: db })
	}).readSingleton({ fields: [
		"project_id",
		"mcp_enabled",
		"mcp_allow_deletes",
		"mcp_system_prompt_enabled",
		"visual_editor_urls",
		"ai_openai_api_key",
		"ai_anthropic_api_key",
		"ai_system_prompt",
		"collaborative_editing_enabled"
	] });
	return {
		project_id: settings.project_id,
		mcp_enabled: settings?.mcp_enabled || false,
		mcp_allow_deletes: settings?.mcp_allow_deletes || false,
		mcp_system_prompt_enabled: settings?.mcp_system_prompt_enabled || false,
		visual_editor_urls: settings.visual_editor_urls?.length || 0,
		ai_openai_api_key: Boolean(settings?.ai_openai_api_key),
		ai_anthropic_api_key: Boolean(settings?.ai_anthropic_api_key),
		ai_system_prompt: Boolean(settings?.ai_system_prompt),
		collaborative_editing_enabled: toBoolean(env["WEBSOCKETS_COLLAB_ENABLED"] ?? true) && (settings?.collaborative_editing_enabled ?? false)
	};
};

//#endregion
export { getSettings };