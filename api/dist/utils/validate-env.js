import { useLogger } from "../logger/index.js";
import { useEnv } from "@directus/env";

//#region src/utils/validate-env.ts
function validateEnv(requiredKeys) {
	const env = useEnv();
	const logger = useLogger();
	for (const requiredKey of requiredKeys) if (requiredKey in env === false) {
		logger.error(`"${requiredKey}" Environment Variable is missing.`);
		process.exit(1);
	}
}

//#endregion
export { validateEnv };