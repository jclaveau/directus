import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import run from "../../../database/migrations/run.js";

//#region src/cli/commands/database/migrate.ts
async function migrate(direction) {
	const database = database_default();
	const logger = useLogger();
	try {
		logger.info("Running migrations...");
		await run(database, direction);
		if (direction === "down") logger.info("Downgrade successful");
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