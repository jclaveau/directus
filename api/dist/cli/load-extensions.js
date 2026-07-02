import { useLogger } from "../logger/index.js";
import { isInstalled, validateMigrations } from "../database/index.js";
import { getExtensionManager } from "../extensions/index.js";
import { useEnv } from "@directus/env";

//#region src/cli/load-extensions.ts
const loadExtensions = async () => {
	const env = useEnv();
	const logger = useLogger();
	if (!("DB_CLIENT" in env)) return;
	if (!await isInstalled()) return;
	if (!await validateMigrations()) {
		logger.info("Skipping CLI extensions initialization due to outstanding migrations.");
		return;
	}
	await getExtensionManager().initialize({
		schedule: false,
		watch: false
	});
};

//#endregion
export { loadExtensions };