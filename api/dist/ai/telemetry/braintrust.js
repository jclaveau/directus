//#region src/ai/telemetry/braintrust.ts
const applyBraintrustEnv = (env) => {
	const apiKey = env["BRAINTRUST_API_KEY"];
	const projectName = env["BRAINTRUST_PROJECT_NAME"];
	const apiUrl = env["BRAINTRUST_API_URL"];
	if (typeof apiKey === "string" && apiKey.length > 0) process.env["BRAINTRUST_API_KEY"] = apiKey;
	if (typeof projectName === "string" && projectName.length > 0) process.env["BRAINTRUST_PROJECT_NAME"] = projectName;
	if (typeof apiUrl === "string" && apiUrl.length > 0) process.env["BRAINTRUST_API_URL"] = apiUrl;
};
const initBraintrust = async (env) => {
	applyBraintrustEnv(env);
	const [{ BraintrustSpanProcessor }, { NodeTracerProvider }] = await Promise.all([import("@braintrust/otel"), import("@opentelemetry/sdk-trace-node")]);
	const tracerProvider = new NodeTracerProvider({ spanProcessors: [new BraintrustSpanProcessor({ filterAISpans: true })] });
	return {
		recordIO: env["AI_TELEMETRY_RECORD_IO"] === true,
		tracerProvider
	};
};

//#endregion
export { applyBraintrustEnv, initBraintrust };