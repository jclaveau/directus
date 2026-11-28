import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import run from "../../../database/migrations/run.js";
import { getExtensionMigrations } from "../../../extensions/lib/get-extension-migrations.js";
import { migrateLatest } from "../../utils/migrate-latest.js";

//#region src/cli/commands/database/migrate.ts
async function migrate(direction, options = {}) {
	const database = database_default();
	const logger = useLogger();
	try {
		logger.info("Running migrations...");
		if (direction === "latest") await migrateLatest(database, options.snapshot, options.phase);
		else await run(database, direction, true, { extensionMigrations: await getExtensionMigrations() });
		if (direction === "down") logger.info("Downgrade successful");
		else if (options.phase !== void 0) logger.info(`Migration phase ${JSON.stringify(options.phase)} up to date`);
		else logger.info("Database up to date");
		database.destroy();
		process.exit();
	} catch (err) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}

//#endregion
export { migrate as default };