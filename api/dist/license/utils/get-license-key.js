import { getSchema } from "../../utils/get-schema.js";
import { SettingsService } from "../../services/settings.js";
import { useEnv } from "@directus/env";

//#region src/license/utils/get-license-key.ts
async function getLicenseKey(options) {
	const env = useEnv();
	if (env["LICENSE_KEY"]) return {
		source: "env",
		key: String(env["LICENSE_KEY"])
	};
	const { license_key } = await new SettingsService({
		schema: await getSchema(options),
		...options
	}).readSingleton({ fields: ["license_key"] });
	return {
		source: license_key ? "settings" : null,
		key: license_key ?? null
	};
}

//#endregion
export { getLicenseKey };