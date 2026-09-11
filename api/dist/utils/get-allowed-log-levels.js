import { useLogger } from "../logger/index.js";

//#region src/utils/get-allowed-log-levels.ts
const logger = useLogger();
const getAllowedLogLevels = (level) => {
	const levelValue = logger.levels.values[level];
	if (levelValue === void 0) throw new Error(`Invalid "${level}" log level`);
	return Object.fromEntries(Object.entries(logger.levels.values).filter(([_, value]) => value >= levelValue).sort((a, b) => a[1] - b[1]));
};

//#endregion
export { getAllowedLogLevels };