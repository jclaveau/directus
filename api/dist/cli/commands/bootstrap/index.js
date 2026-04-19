import { useLogger } from "../../../logger/index.js";
import database_default, { hasDatabaseConnection, isInstalled, validateDatabaseConnection } from "../../../database/index.js";
import { AccessService } from "../../../services/access.js";
import { SettingsService } from "../../../services/settings.js";
import { getSchema } from "../../../utils/get-schema.js";
import { UsersService } from "../../../services/users.js";
import { RolesService } from "../../../services/roles.js";
import { PoliciesService } from "../../../services/policies.js";
import run from "../../../database/migrations/run.js";
import runSeed from "../../../database/seeds/run.js";
import { defaultAdminPolicy, defaultAdminRole, defaultAdminUser } from "../../utils/defaults.js";
import { useEnv } from "@directus/env";

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
		if (skipAdminInit == null) await createDefaultAdmin(schema);
		else logger.info("Skipping creation of default Admin user and role...");
		if (env["PROJECT_NAME"] && typeof env["PROJECT_NAME"] === "string" && env["PROJECT_NAME"].length > 0) await new SettingsService({ schema }).upsertSingleton({ project_name: env["PROJECT_NAME"] });
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
async function createDefaultAdmin(schema) {
	const logger = useLogger();
	const env = useEnv();
	const { nanoid } = await import("nanoid");
	logger.info("Setting up first admin role...");
	const accessService = new AccessService({ schema });
	const policiesService = new PoliciesService({ schema });
	const role = await new RolesService({ schema }).createOne(defaultAdminRole);
	const policy = await policiesService.createOne(defaultAdminPolicy);
	await accessService.createOne({
		policy,
		role
	});
	logger.info("Adding first admin user...");
	const usersService = new UsersService({ schema });
	let adminEmail = env["ADMIN_EMAIL"];
	if (!adminEmail) {
		logger.info("No admin email provided. Defaulting to \"admin@example.com\"");
		adminEmail = "admin@example.com";
	}
	let adminPassword = env["ADMIN_PASSWORD"];
	if (!adminPassword) {
		adminPassword = nanoid(12);
		logger.info(`No admin password provided. Defaulting to "${adminPassword}"`);
	}
	const token = env["ADMIN_TOKEN"] ?? null;
	await usersService.createOne({
		...defaultAdminUser,
		email: adminEmail,
		password: adminPassword,
		token,
		role
	});
}

//#endregion
export { bootstrap as default };