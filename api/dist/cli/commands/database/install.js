import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import runSeed from "../../../database/seeds/run.js";

//#region src/cli/commands/database/install.ts
async function start() {
	const database = database_default();
	const logger = useLogger();
	try {
		await runSeed(database);
		database.destroy();
		process.exit(0);
	} catch (err) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}

//#endregion
export { start as default };