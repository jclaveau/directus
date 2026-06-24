import { useLogger } from "../../logger/index.js";
import { useEnv } from "@directus/env";

//#region src/ai/telemetry/index.ts
let telemetryState = null;
let telemetryInitPromise = null;
async function doTelemetryInit() {
	const env = useEnv();
	if (env["AI_TELEMETRY_ENABLED"] !== true) return;
	const logger = useLogger();
	const provider = env["AI_TELEMETRY_PROVIDER"] || "langfuse";
	const missing = ({
		langfuse: ["LANGFUSE_SECRET_KEY", "LANGFUSE_PUBLIC_KEY"],
		braintrust: ["BRAINTRUST_API_KEY"]
	}[provider] ?? []).filter((key) => !(typeof env[key] === "string" && env[key].length > 0));
	if (missing.length > 0) logger.warn(`AI telemetry provider "${provider}" is missing required config: ${missing.join(", ")}`);
	try {
		let state;
		switch (provider) {
			case "langfuse": {
				const { initLangfuse } = await import("./langfuse.js");
				state = await initLangfuse(env);
				break;
			}
			case "braintrust": {
				const { initBraintrust } = await import("./braintrust.js");
				state = await initBraintrust(env);
				break;
			}
			default:
				logger.warn(`Unknown AI telemetry provider "${provider}". Supported: langfuse, braintrust`);
				return;
		}
		telemetryState = state;
		logger.info(`AI telemetry enabled via ${provider}`);
	} catch (error) {
		logger.warn(error, "Failed to initialize AI telemetry");
	}
}
const initAITelemetry = async () => {
	if (telemetryState) return;
	if (telemetryInitPromise) return telemetryInitPromise;
	const initPromise = doTelemetryInit().finally(() => {
		telemetryInitPromise = null;
	});
	telemetryInitPromise = initPromise;
	return initPromise;
};
const getAITelemetryConfig = (metadata, functionId = "directus-ai-chat") => {
	if (!telemetryState) return void 0;
	const telemetryMetadata = {
		provider: metadata.provider,
		model: metadata.model,
		...metadata.userId != null ? { userId: metadata.userId } : {},
		...metadata.role != null ? { role: metadata.role } : {}
	};
	return {
		isEnabled: true,
		tracer: telemetryState.tracerProvider.getTracer("directus-ai"),
		functionId,
		recordInputs: telemetryState.recordIO,
		recordOutputs: telemetryState.recordIO,
		metadata: telemetryMetadata
	};
};
const shutdownAITelemetry = async () => {
	if (telemetryInitPromise) await telemetryInitPromise;
	if (!telemetryState) return;
	const logger = useLogger();
	const { tracerProvider } = telemetryState;
	telemetryState = null;
	try {
		await tracerProvider.shutdown();
	} catch (error) {
		logger.warn(error, "Failed to shut down AI telemetry");
	}
};

//#endregion
export { getAITelemetryConfig, initAITelemetry, shutdownAITelemetry };