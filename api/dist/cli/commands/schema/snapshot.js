import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import { getSnapshot } from "../../../utils/get-snapshot.js";
import path from "path";
import { dump } from "js-yaml";
import { constants, promises } from "fs";
import inquirer from "inquirer";

//#region src/cli/commands/schema/snapshot.ts
async function snapshot(snapshotPath, options) {
	const database = database_default();
	const logger = useLogger();
	try {
		const snapshot$1 = await getSnapshot({ database });
		let snapshotString;
		if (options?.format === "yaml") snapshotString = dump(snapshot$1);
		else snapshotString = JSON.stringify(snapshot$1);
		if (snapshotPath) {
			const filename = path.resolve(process.cwd(), snapshotPath);
			let snapshotExists;
			try {
				await promises.access(filename, constants.F_OK);
				snapshotExists = true;
			} catch {
				snapshotExists = false;
			}
			if (snapshotExists && options?.yes === false) {
				const { overwrite } = await inquirer.prompt([{
					type: "confirm",
					name: "overwrite",
					message: "Snapshot already exists. Do you want to overwrite the file?"
				}]);
				if (overwrite === false) {
					database.destroy();
					process.exit(0);
				}
			}
			await promises.writeFile(filename, snapshotString);
			logger.info(`Snapshot saved to ${filename}`);
		} else process.stdout.write(snapshotString);
		database.destroy();
		process.exit(0);
	} catch (err) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}

//#endregion
export { snapshot };