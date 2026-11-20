import { useLogger } from "../logger/index.js";
import { isInstalled, outstandingMigrationsOrExit } from "../database/index.js";
import { getExtensionManager } from "../extensions/index.js";
import { getExtensionMigrations } from "../extensions/lib/get-extension-migrations.js";
import { useEnv } from "@directus/env";

//#region src/cli/load-extensions.ts
const loadExtensions = async () => {
	const env = useEnv();
	const logger = useLogger();
	if (!("DB_CLIENT" in env)) return;
	if (!await isInstalled()) return;
	if ((await outstandingMigrationsOrExit(await readBeforeSchemaMigrations())).length > 0) {
		logger.info("Skipping CLI extensions initialization due to outstanding migrations.");
		return;
	}
	await getExtensionManager().initialize({
		schedule: false,
		watch: false
	});
};
async function readBeforeSchemaMigrations() {
	try {
		return (await getExtensionMigrations()).filter(({ config }) => config.phase !== "after-schema");
	} catch (error) {
		useLogger().warn(error, "Could not read the migrations of the bundles");
		return [];
	}
}

//#endregion
export { loadExtensions };