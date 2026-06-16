import { useLogger } from "../../../logger/index.js";
import database_default, { hasDatabaseConnection, isInstalled, validateDatabaseConnection } from "../../../database/index.js";
import { getSchema } from "../../../utils/get-schema.js";
import { getEntitlementManager } from "../../../license/entitlements/manager.js";
import { SettingsService } from "../../../services/settings.js";
import "../../../license/index.js";
import { createAdmin } from "../../../utils/create-admin.js";
import run from "../../../database/migrations/run.js";
import runSeed from "../../../database/seeds/run.js";
import { useEnv } from "@directus/env";
import { email } from "zod";

//#region src/cli/commands/bootstrap/index.ts
async function bootstrap({ skipAdminInit }) {
	const logger = useLogger();
	logger.info("Initializing bootstrap...");
	const env = useEnv();
	const database = database_default();
	await waitForDatabase(database);
	if (await isInstalled() === false) {
		logger.info("Installing Directus system tables...");
		await runSeed(database);
		logger.info("Running migrations...");
		await run(database, "latest");
		const schema = await getSchema();
		getEntitlementManager();
		if (skipAdminInit == null) await createAdmin(schema);
		else logger.info("Skipping creation of default Admin user and role...");
		const settingsService = new SettingsService({ schema });
		if (env["PROJECT_NAME"] && typeof env["PROJECT_NAME"] === "string" && env["PROJECT_NAME"].length > 0) await settingsService.upsertSingleton({ project_name: env["PROJECT_NAME"] });
		if (email().safeParse(env["PROJECT_OWNER"]).success) await settingsService.setOwner({
			project_owner: env["PROJECT_OWNER"],
			org_name: null,
			project_usage: null,
			product_updates: false
		});
	} else {
		logger.info("Database already initialized, skipping install");
		logger.info("Running migrations...");
		await run(database, "latest");
	}
	await database.destroy();
	logger.info("Done");
	process.exit(0);
}
async function waitForDatabase(database) {
	const tries = 5;
	const secondsBetweenTries = 5;
	for (let i = 0; i < tries; i++) {
		if (await hasDatabaseConnection(database)) return true;
		await new Promise((resolve) => setTimeout(resolve, secondsBetweenTries * 1e3));
	}
	await validateDatabaseConnection(database);
	return database;
}

//#endregion
export { bootstrap as default };