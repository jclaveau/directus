import { getSchema } from "../../utils/get-schema.js";
import { SettingsService } from "../../services/settings.js";
import { useEnv } from "@directus/env";

//#region src/license/utils/get-license-token.ts
async function getLicenseToken(options) {
	const env = useEnv();
	if (env["LICENSE_TOKEN"]) return {
		source: "env",
		token: String(env["LICENSE_TOKEN"])
	};
	const { license_token } = await new SettingsService({
		schema: await getSchema(options),
		...options
	}).readSingleton({ fields: ["license_token"] });
	return {
		source: license_token ? "settings" : null,
		token: license_token ?? null
	};
}

//#endregion
export { getLicenseToken };