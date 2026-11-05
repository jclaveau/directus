import { useLogger } from "../logger/index.js";
import { useEnv } from "@directus/env";
import { access } from "node:fs/promises";
import path from "node:path";
import { toArray } from "@directus/utils";
import { constants } from "node:fs";

//#region src/utils/validate-storage.ts
async function validateStorage() {
	const env = useEnv();
	const logger = useLogger();
	if (env["DB_CLIENT"] === "sqlite3") try {
		await access(path.dirname(env["DB_FILENAME"]), constants.R_OK | constants.W_OK);
	} catch {
		logger.warn(`Directory for SQLite database file (${path.resolve(path.dirname(env["DB_FILENAME"]))}) is not read/writeable!`);
	}
	if (toArray(env["STORAGE_LOCATIONS"]).map((location) => env[`STORAGE_${location.toUpperCase()}_DRIVER`]).includes("local")) try {
		await access(env["STORAGE_LOCAL_ROOT"], constants.R_OK | constants.W_OK);
	} catch {
		logger.warn(`Upload directory (${path.resolve(env["STORAGE_LOCAL_ROOT"])}) is not read/writeable!`);
	}
}

//#endregion
export { validateStorage };