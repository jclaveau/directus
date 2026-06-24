import { t as __export } from "./chunk-Bp6m_JJh.js";
import { n as createLicense, r as generateKey, t as startServer } from "./app-C49Oxo-c.js";
import { LICENSE_API_VERSION } from "@directus/license";

//#region src/client.ts
var client_exports = /* @__PURE__ */ __export({
	activateKey: () => activateKey,
	registerLicense: () => registerLicense
});
async function registerLicense(base, license) {
	const res = await fetch(`${base}/admin/license`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(license)
	});
	if (!res.ok) throw new Error(`registerLicense failed: ${res.status} ${await res.text()}`);
}
async function activateKey(base, body) {
	const res = await fetch(`${base}/api/licenses/activate`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Directus-License-Version": LICENSE_API_VERSION
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`activateKey failed: ${res.status} ${await res.text()}`);
	return await res.json();
}

//#endregion
export { createLicense, generateKey, client_exports as mockClient, startServer };