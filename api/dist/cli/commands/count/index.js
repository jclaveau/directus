import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";

//#region src/cli/commands/count/index.ts
async function count(collection) {
	const database = database_default();
	const logger = useLogger();
	if (!collection) {
		logger.error("Collection is required");
		process.exit(1);
	}
	try {
		const records = await database(collection).count("*", { as: "count" });
		const count$1 = Number(records[0].count);
		process.stdout.write(`${count$1}\n`);
		database.destroy();
		process.exit(0);
	} catch (err) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}

//#endregion
export { count as default };