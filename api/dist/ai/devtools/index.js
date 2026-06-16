import { useLogger } from "../../logger/index.js";
import { useEnv } from "@directus/env";
import { getNodeEnv } from "@directus/utils/node";

//#region src/ai/devtools/index.ts
let devToolsMiddleware = null;
let devToolsInitPromise = null;
async function doDevToolsInit() {
	if (useEnv()["AI_DEVTOOLS_ENABLED"] !== true) return;
	const logger = useLogger();
	if (getNodeEnv() === "production") {
		logger.warn("AI DevTools is enabled but refused in production");
		return;
	}
	try {
		const { devToolsMiddleware: createDevToolsMiddleware } = await import("@ai-sdk/devtools");
		devToolsMiddleware = createDevToolsMiddleware();
		logger.info("AI DevTools middleware enabled. Run `npx @ai-sdk/devtools` and open http://localhost:4983");
	} catch (error) {
		logger.warn(error, "Failed to initialize AI DevTools middleware");
	}
}
const initAIDevTools = async () => {
	if (devToolsMiddleware) return;
	if (devToolsInitPromise) return devToolsInitPromise;
	const initPromise = doDevToolsInit().finally(() => {
		devToolsInitPromise = null;
	});
	devToolsInitPromise = initPromise;
	return initPromise;
};
const getDevToolsMiddleware = () => {
	return devToolsMiddleware;
};

//#endregion
export { getDevToolsMiddleware, initAIDevTools };