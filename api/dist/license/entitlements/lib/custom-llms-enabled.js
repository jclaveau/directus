import { CUSTOM_LLM_FIELDS } from "../../../constants.js";
import database_default from "../../../database/index.js";
import { getSchema } from "../../../utils/get-schema.js";
import { SettingsService } from "../../../services/settings.js";
import "../../../services/index.js";

//#region src/license/entitlements/lib/custom-llms-enabled.ts
async function checkCustomLLM(opts) {
	const knex = opts?.knex ?? database_default();
	const data = await new SettingsService({
		schema: await getSchema({ database: knex }),
		knex
	}).readSingleton({ fields: [...CUSTOM_LLM_FIELDS] });
	return !CUSTOM_LLM_FIELDS.find((key) => data[key] !== null);
}

//#endregion
export { checkCustomLLM };