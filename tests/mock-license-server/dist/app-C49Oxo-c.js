import { hash, randomUUID } from "crypto";
import { License } from "@directus/license";
import { generateKeyPair } from "jose";
import { SignJWT } from "jose/jwt/sign";
import { merge } from "lodash-es";
import { env } from "process";
import Fastify from "fastify";
import { exportJWK } from "jose/key/export";
import Type from "typebox";

//#region src/constants.ts
const DAY_IN_S = 3600 * 24;

//#endregion
//#region src/utils.ts
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function luhnChecksum(payload) {
	let sum = 0;
	for (let i = 0; i < payload.length; i++) {
		const char = payload.at(-(1 + i));
		const value = ALPHABET.indexOf(char);
		if ((i + 1) % 2 !== 0) {
			let doubled = value * 2;
			if (doubled >= 32) doubled -= 31;
			sum += doubled;
		} else sum += value;
	}
	return ALPHABET[(32 - sum % 32) % 32];
}
function generateKey() {
	const c = Array.from({ length: 23 }, () => Math.floor(Math.random() * 32)).map((i) => ALPHABET[i]).join("");
	return `D${c.slice(0, 4)}-${c.slice(4, 9)}-${c.slice(9, 14)}-${c.slice(14, 19)}-${c.slice(19, 23) + luhnChecksum(`D${c}`)}`;
}
function createLicense(overrides) {
	const key = overrides?.key ?? generateKey();
	const now$1 = Math.floor(Date.now() / 1e3);
	return merge({
		key,
		max_projects: 10,
		projects: [],
		addons: [],
		name: `mock-${key}`,
		meta: {
			name: "mock",
			version: "2026-05-08",
			grace_period: DAY_IN_S,
			validation_interval: 3600,
			expires_at: now$1 + 30 * DAY_IN_S,
			offline: false
		},
		entitlements: {
			collections: { limit: -1 },
			seats: { limit: -1 },
			activity_historical_timeframe: { limit: -1 },
			revision_historical_timeframe: { limit: -1 },
			sso_enabled: { default: true },
			offline_enabled: { default: false },
			telemetry_required: { default: false },
			display_powered_by: "HIDDEN",
			custom_llms_enabled: { default: true },
			custom_permission_rules_enabled: { default: true },
			ai_translations_enabled: { default: true },
			production_enabled: { default: true },
			flows: { limit: -1 }
		}
	}, overrides);
}
const { privateKey, publicKey } = await generateKeyPair("EdDSA");
const TOKEN_LIFETIME_IN_S = 10080 * 60;
async function createToken(license) {
	const encodedToken = License.encode({
		entitlements: license.entitlements,
		meta: license.meta
	});
	const now$1 = Math.floor(Date.now() / 1e3);
	return new SignJWT(encodedToken).setProtectedHeader({ alg: "EdDSA" }).setIssuer("directus-licensing-service").setAudience("directus").setIssuedAt(now$1).setJti(randomUUID()).setExpirationTime(now$1 + TOKEN_LIFETIME_IN_S).sign(privateKey);
}

//#endregion
//#region src/errors.ts
const ErrorCode = {
	BAD_REQUEST: "BAD_REQUEST",
	UNAUTHORIZED: "UNAUTHORIZED",
	FORBIDDEN: "FORBIDDEN",
	NOT_FOUND: "NOT_FOUND",
	UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
	RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
	INTERNAL_ERROR: "INTERNAL_ERROR",
	SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
	LICENSE_EXPIRED: "LICENSE_EXPIRED",
	LICENSE_CANCELED: "LICENSE_CANCELED",
	LICENSE_BOUND: "LICENSE_BOUND",
	BINDING_MISMATCH: "BINDING_MISMATCH",
	INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
	SUBSCRIPTION_PAST_DUE: "SUBSCRIPTION_PAST_DUE",
	NO_PAYMENT_METHOD: "NO_PAYMENT_METHOD",
	ADDON_NOT_ALLOWED: "ADDON_NOT_ALLOWED",
	SEAT_OVERFLOW: "SEAT_OVERFLOW",
	OPERATION_IN_PROGRESS: "OPERATION_IN_PROGRESS",
	CACHE_STALE: "CACHE_STALE",
	BILLING_LINKAGE_MISSING: "BILLING_LINKAGE_MISSING"
};
function createError(message, errorCode, context) {
	return { errors: [{
		message,
		extensions: {
			code: errorCode ?? ErrorCode.INTERNAL_ERROR,
			message,
			...context
		}
	}] };
}
function badRequestError(message, context) {
	return createError(message, ErrorCode.BAD_REQUEST, context);
}
function forbiddenError(message, errorCode, context) {
	return createError(message, errorCode ?? ErrorCode.FORBIDDEN, context);
}
function notFoundError(message) {
	return createError(message, ErrorCode.NOT_FOUND);
}

//#endregion
//#region src/hooks/require-license-version.ts
const LICENSE_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const requireLicenseVersion = async (req, reply) => {
	const license_version = req.headers["directus-license-version"];
	if (typeof license_version !== "string" || !LICENSE_VERSION_PATTERN.test(license_version)) return reply.status(400).send(badRequestError("Missing or malformed Directus-License-Version header"));
};

//#endregion
//#region src/store.ts
const now = () => Math.floor(Date.now() / 1e3);
/**
* Pre-registered licenses shared across tests.
*
* Only configurations used by more than one test file should live here.
* One-off licenses can be built inline via `createLicense({ ... })`.
*
*/
const licenseStore = {
	"D0000-00000-00000-00000-0000K": createLicense({
		key: "D0000-00000-00000-00000-0000K",
		name: "UNLIMITED",
		meta: { name: "UNLIMITED" }
	}),
	"D0001-00000-00000-00000-0000J": createLicense({
		key: "D0001-00000-00000-00000-0000J",
		name: "LIMITED",
		meta: { name: "LIMITED" },
		entitlements: {
			collections: { limit: 50 },
			seats: { limit: 10 },
			flows: { limit: 25 },
			activity_historical_timeframe: { limit: 90 * DAY_IN_S },
			revision_historical_timeframe: { limit: 90 * DAY_IN_S },
			sso_enabled: { default: true },
			offline_enabled: { default: false },
			telemetry_required: { default: false },
			display_powered_by: "HIDDEN",
			custom_llms_enabled: { default: true },
			custom_permission_rules_enabled: { default: true },
			ai_translations_enabled: { default: true },
			production_enabled: { default: true }
		},
		addons: [
			{
				id: randomUUID(),
				active_quantity: 0,
				billing_interval: "monthly",
				description: "Seats Addon",
				icon: "group",
				min_quantity: 0,
				max_quantity: 10,
				name: "Lorem Ipsum",
				pricing_summary: "The seat addon pricing summary",
				unit: "seats",
				upgrade_required: false
			},
			{
				id: randomUUID(),
				active_quantity: 1,
				billing_interval: "monthly",
				description: "Collections Addon",
				icon: "deployed_code",
				min_quantity: 0,
				max_quantity: 10,
				name: "Dolor Sat",
				pricing_summary: "The collection addon pricing summary",
				unit: "collections",
				upgrade_required: false
			},
			{
				id: randomUUID(),
				active_quantity: 2,
				billing_interval: "monthly",
				description: "Upgrade Addon",
				icon: "deployed_code",
				min_quantity: 0,
				max_quantity: 10,
				name: "Amet",
				pricing_summary: "The upgrade addon pricing summary",
				unit: "flows",
				upgrade_required: true
			}
		]
	}),
	"D0002-00000-00000-00000-0000H": createLicense({
		key: "D0002-00000-00000-00000-0000H",
		name: "LIMITED_GRACE",
		meta: {
			name: "LIMITED_GRACE",
			version: "2026-05-08",
			grace_period: 7 * DAY_IN_S,
			validation_interval: 3600,
			expires_at: now() - 2 * DAY_IN_S,
			offline: false
		},
		entitlements: {
			collections: { limit: 50 },
			seats: { limit: 10 },
			flows: { limit: 25 },
			activity_historical_timeframe: { limit: 90 * DAY_IN_S },
			revision_historical_timeframe: { limit: 90 * DAY_IN_S },
			sso_enabled: { default: true },
			offline_enabled: { default: false },
			telemetry_required: { default: false },
			display_powered_by: "HIDDEN",
			custom_llms_enabled: { default: true },
			custom_permission_rules_enabled: { default: true },
			ai_translations_enabled: { default: true },
			production_enabled: { default: true }
		}
	}),
	"D0003-00000-00000-00000-0000G": createLicense({
		key: "D0003-00000-00000-00000-0000G",
		name: "LIMITED_EXPIRED",
		meta: {
			name: "LIMITED_EXPIRED",
			version: "2026-05-08",
			grace_period: DAY_IN_S,
			validation_interval: 3600,
			expires_at: now() - 10 * DAY_IN_S,
			offline: false
		},
		entitlements: {
			collections: { limit: 50 },
			seats: { limit: 10 },
			flows: { limit: 25 },
			activity_historical_timeframe: { limit: 90 * DAY_IN_S },
			revision_historical_timeframe: { limit: 90 * DAY_IN_S },
			sso_enabled: { default: true },
			offline_enabled: { default: false },
			telemetry_required: { default: false },
			display_powered_by: "HIDDEN",
			custom_llms_enabled: { default: true },
			custom_permission_rules_enabled: { default: true },
			ai_translations_enabled: { default: true },
			production_enabled: { default: true }
		}
	}),
	"D0005-00000-00000-00000-0000E": createLicense({
		key: "D0005-00000-00000-00000-0000E",
		name: "TINY",
		meta: { name: "TINY" },
		entitlements: {
			collections: { limit: 1 },
			seats: { limit: 1 },
			flows: { limit: 1 },
			activity_historical_timeframe: { limit: 7 * DAY_IN_S },
			revision_historical_timeframe: { limit: 7 * DAY_IN_S },
			sso_enabled: { default: false },
			offline_enabled: { default: false },
			telemetry_required: { default: false },
			display_powered_by: "DIRECTUS",
			custom_llms_enabled: { default: false },
			custom_permission_rules_enabled: { default: false },
			ai_translations_enabled: { default: false },
			production_enabled: { default: false }
		}
	})
};

//#endregion
//#region src/routes/activate.ts
const ActivateRequestSchema = Type.Object({
	license_key: Type.String({ minLength: 1 }),
	project_id: Type.String({ minLength: 1 }),
	public_url: Type.String({ minLength: 1 })
});
async function activateRoute(app$1) {
	app$1.post("/", { schema: { body: ActivateRequestSchema } }, async (req, res) => {
		const { license_key, project_id, public_url } = req.body;
		const license = licenseStore[license_key];
		if (!license) return res.status(404).send(notFoundError("License not available"));
		if (license.projects.length >= license.max_projects) return res.status(400).send(forbiddenError("License usage limit reached"));
		if (license.projects.some(({ id, url }) => id === project_id && url === public_url)) return res.status(400).send(forbiddenError("License already used"));
		let collidingLicense;
		for (const license$1 of Object.values(licenseStore)) {
			if (license$1.key === license_key) continue;
			for (const { id, url } of license$1.projects) {
				if (id !== project_id) continue;
				if (url === public_url) return res.status(400).send(forbiddenError("Project already used by different license key"));
				else collidingLicense = license$1;
			}
		}
		if (collidingLicense) {
			const new_project_id = randomUUID();
			license.projects.push({
				id: new_project_id,
				url: public_url
			});
			return res.status(200).send({
				token: await createToken(license),
				new_project_id
			});
		}
		license.projects.push({
			id: project_id,
			url: public_url
		});
		return res.status(200).send({ token: await createToken(license) });
	});
}

//#endregion
//#region src/hooks/require-license.ts
const requireLicense = async (req, reply) => {
	const license_key = req.headers["directus-license-key"];
	const project_id = req.headers["directus-project-id"];
	const public_url = req.headers["directus-public-url"];
	if (typeof license_key !== "string" || typeof project_id !== "string" || typeof public_url !== "string") return reply.status(400).send(forbiddenError("License not found"));
	const license = Object.values(licenseStore).find((license$1) => license$1.key === license_key && license$1.projects.some(({ id, url }) => id === project_id && url === public_url));
	if (!license) return reply.status(400).send(forbiddenError("License not found"));
	req.license = license;
};

//#endregion
//#region src/types.ts
const LicenseAuthHeaders = Type.Object({
	"directus-license-key": Type.String({ minLength: 1 }),
	"directus-project-id": Type.String({ minLength: 1 }),
	"directus-public-url": Type.String({ minLength: 1 })
}, { additionalProperties: true });

//#endregion
//#region src/routes/addons.ts
const UpdateAddonsRequestSchema = Type.Object({
	addons: Type.Array(Type.Object({
		addon_id: Type.String({ minLength: 1 }),
		quantity: Type.Number()
	})),
	usage_metrics: Type.Object({
		seats: Type.Number(),
		collections: Type.Number(),
		flows: Type.Number()
	}, { additionalProperties: false })
}, { additionalProperties: false });
const DeleteAddonsRequestSchema = Type.Array(Type.String({ minLength: 1 }));
async function addonsRoute(app$1) {
	app$1.get("/options", {
		schema: { headers: LicenseAuthHeaders },
		preHandler: requireLicense
	}, async (req, res) => {
		return res.status(200).send({ available_addons: req.license.addons });
	});
	app$1.patch("/", {
		schema: {
			headers: LicenseAuthHeaders,
			body: UpdateAddonsRequestSchema
		},
		preHandler: requireLicense
	}, async (req, res) => {
		for (const { addon_id, quantity } of req.body.addons) {
			const addon = req.license.addons.find((a) => a.id === addon_id);
			if (!addon) return res.status(404).send(notFoundError(`Addon ${addon_id} not available`));
			if (quantity < addon.min_quantity || quantity > addon.max_quantity) return res.status(400).send(forbiddenError(`Quantity ${quantity} out of range for addon ${addon_id}`));
			req.license.entitlements[addon.unit].limit += quantity - addon.active_quantity;
			req.license.entitlements[addon.unit].addon = (req.license.entitlements[addon.unit].addon ?? 0) + quantity - addon.active_quantity;
			if (req.license.entitlements[addon.unit].addon === 0) delete req.license.entitlements[addon.unit].addon;
			addon.active_quantity = quantity;
		}
		return res.status(200).send({ token: await createToken(req.license) });
	});
	app$1.delete("/", {
		schema: {
			headers: LicenseAuthHeaders,
			body: DeleteAddonsRequestSchema
		},
		preHandler: requireLicense
	}, async (req, res) => {
		for (const addon_id of req.body) {
			const addon = req.license.addons.find((a) => a.id === addon_id);
			if (!addon) return res.status(404).send(notFoundError(`Addon ${addon_id} not available`));
			req.license.entitlements[addon.unit].limit -= addon.active_quantity;
			delete req.license.entitlements[addon.unit].addon;
			addon.active_quantity = 0;
		}
		return res.status(204).send();
	});
}

//#endregion
//#region src/routes/admin.ts
async function adminRoute(app$1) {
	app$1.post("/", async (req, res) => {
		licenseStore[req.body.key] = req.body;
		return res.send(req.body);
	});
	app$1.get("/", async (_req, res) => {
		return res.send(Object.values(licenseStore));
	});
	app$1.get("/:license_key", async (req, res) => {
		const license = licenseStore[req.params.license_key];
		if (!license) return res.status(404).send({ error: "License not found" });
		res.send(license);
	});
	app$1.patch("/:license_key", async (req, res) => {
		const license = licenseStore[req.params.license_key];
		if (!license) return res.status(404).send({ error: "License not found" });
		licenseStore[req.params.license_key] = merge(license, req.body);
		res.send(license);
	});
	app$1.delete("/:license_key", async (req, res) => {
		if (!(req.params.license_key in licenseStore)) return res.status(404).send({ error: "License not found" });
		delete licenseStore[req.params.license_key];
		res.status(204).send();
	});
}

//#endregion
//#region src/routes/deactivate.ts
async function deactivateRoute(app$1) {
	app$1.post("/", {
		schema: { headers: LicenseAuthHeaders },
		preHandler: requireLicense
	}, async (req, res) => {
		const project_id = req.headers["directus-project-id"];
		const public_url = req.headers["directus-public-url"];
		req.license.projects = req.license.projects.filter(({ id, url }) => id !== project_id || url !== public_url);
		return res.status(204).send();
	});
}

//#endregion
//#region src/routes/portal.ts
async function portalRoute(app$1) {
	app$1.post("/", {
		schema: { headers: LicenseAuthHeaders },
		preHandler: requireLicense
	}, async (req, res) => {
		const project_id = req.headers["directus-project-id"];
		const public_url = req.headers["directus-public-url"];
		return res.status(200).send({ url: `https://shop.nitwel.no/sessions/${hash("sha256", Buffer.from(project_id + public_url), "hex")}` });
	});
}

//#endregion
//#region src/routes/preview.ts
const PreviewRequestSchema = Type.Object({ license_key: Type.String({
	minLength: 1,
	maxLength: 64
}) });
async function previewRoute(app$1) {
	app$1.post("/", { schema: { body: PreviewRequestSchema } }, async (req, res) => {
		const license = licenseStore[req.body.license_key];
		if (!license) return res.status(404).send(notFoundError("License not available"));
		return res.status(200).send({
			plan_name: license.name,
			expires_at: license.meta.expires_at,
			renews_at: license.meta.renews_at,
			entitlements: license.entitlements
		});
	});
}

//#endregion
//#region src/routes/refresh.ts
const RefreshRequestBody = Type.Object({ usage_metrics: Type.Object({
	seats: Type.Number(),
	collections: Type.Number(),
	flows: Type.Number()
}, { additionalProperties: false }) }, { additionalProperties: false });
async function refreshRoute(app$1) {
	app$1.post("/", {
		schema: {
			body: RefreshRequestBody,
			headers: LicenseAuthHeaders
		},
		preHandler: requireLicense
	}, async (req, res) => {
		return res.status(200).send({ token: await createToken(req.license) });
	});
}

//#endregion
//#region src/routes/update.ts
const UpdateRequestSchema = Type.Object({ license_key: Type.String({
	minLength: 1,
	maxLength: 64
}) });
async function updateRoute(app$1) {
	app$1.post("/", {
		schema: {
			headers: LicenseAuthHeaders,
			body: UpdateRequestSchema
		},
		preHandler: requireLicense
	}, async (req, res) => {
		const project_id = req.headers["directus-project-id"];
		const public_url = req.headers["directus-public-url"];
		const new_license = Object.values(licenseStore).find((license) => license.key === req.body.license_key && license.projects.every(({ id, url }) => id !== project_id && url !== public_url));
		if (!new_license) return res.status(400).send(forbiddenError("New License not found"));
		req.license.projects = req.license.projects.filter(({ id, url }) => id !== project_id || url !== public_url);
		new_license.projects.push({
			id: project_id,
			url: public_url
		});
		return res.status(200).send({ token: await createToken(new_license) });
	});
}

//#endregion
//#region src/app.ts
const app = Fastify({ logger: true });
app.withTypeProvider();
app.register(async (admin) => {
	admin.register(adminRoute, { prefix: "/license" });
}, { prefix: "/admin" });
app.register(async (api) => {
	api.addHook("preHandler", requireLicenseVersion);
	api.register(previewRoute, { prefix: "/preview" });
	api.register(activateRoute, { prefix: "/activate" });
	api.register(updateRoute, { prefix: "/update" });
	api.register(deactivateRoute, { prefix: "/deactivate" });
	api.register(refreshRoute, { prefix: "/refresh" });
	api.register(portalRoute, { prefix: "/portal" });
	api.register(addonsRoute, { prefix: "/addons" });
}, { prefix: "/api/licenses" });
app.get("/.well-known/jwks.json", async (_req, res) => {
	return res.send({ keys: [await exportJWK(publicKey)] });
});
const startServer = async () => {
	try {
		await app.listen({ port: Number(env["LICENSE_PORT"] ?? 1133) });
		app.log.info(`Server listening on ${app.server.address()}`);
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
};

//#endregion
export { createLicense as n, generateKey as r, startServer as t };