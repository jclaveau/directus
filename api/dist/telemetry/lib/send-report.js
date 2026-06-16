import { useEnv } from "@directus/env";
import { URL } from "node:url";

//#region src/telemetry/lib/send-report.ts
/**
* Post an anonymous usage report to the centralized intake server
*/
const sendReport = async (report) => {
	const env = useEnv();
	const url = "project_owner" in report ? new URL("/v1/owner", String(env["COMPLIANCE_URL"])) : new URL("/v1/metrics", String(env["TELEMETRY_URL"]));
	const headers = { "Content-Type": "application/json" };
	if (env["TELEMETRY_AUTHORIZATION"]) headers["Authorization"] = env["TELEMETRY_AUTHORIZATION"];
	const res = await fetch(url, {
		method: "POST",
		body: JSON.stringify(report),
		headers
	});
	if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
};

//#endregion
export { sendReport };