import { useLogger } from "../logger/index.js";
import { clearCache } from "../permissions/cache.js";
import schedule, { stopLicenseCheck } from "../schedules/license.js";
import { useStore } from "../utils/store.js";
import { getSchema } from "../utils/get-schema.js";
import { getActiveCollections } from "./entitlements/lib/collections.js";
import { getActiveFlows } from "./entitlements/lib/flows.js";
import { getActiveSeats } from "./entitlements/lib/seats.js";
import { EntitlementManager, getEntitlementManager } from "./entitlements/manager.js";
import { SettingsService } from "../services/settings.js";
import { UsersService } from "../services/users.js";
import "../services/index.js";
import { computeLicenseStatus } from "./utils/compute-license-status.js";
import { getLicenseKey } from "./utils/get-license-key.js";
import { getLicenseToken } from "./utils/get-license-token.js";
import { handleLicenseError } from "./utils/handle-license-error.js";
import { useRPC } from "./utils/use-rpc.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { CORE_LICENSE, COUNTABLE_ENTITLEMENT_KEYS, LicenseServerError, ResolveInput, activateKey, billingPortal, deactivateKey, deleteAddon, previewKey, readAddons, refreshLicense, updateAddonQuantity, updateKey, verifyLicense } from "@directus/license";

//#region src/license/manager.ts
const env = useEnv();
const logger = useLogger();
const LICENSE_CHANNEL = `license`;
let licenseCache;
let licenseManager;
function getLicenseManager() {
	if (licenseManager) return licenseManager;
	licenseManager = new LicenseManager();
	return licenseManager;
}
var LicenseManager = class {
	licenseKey = null;
	licenseToken = null;
	/** Where the key or token comes from */
	source = null;
	initialized = false;
	rpc = useRPC(this, LICENSE_CHANNEL);
	store = useStore(String(env["LICENSE_NAMESPACE"]));
	/**
	* Initialize license state based on the following state permutations.
	*
	* | envKey | envToken | dbKey | dbToken | diff | Outcome                                      |  id  |
	* | :----: | :------: | :---: | :-----: | :--: | -------------------------------------------- | ---- |
	* |   ✓    |    ✓     |   *   |    *    |   *  | **Error** — both env vars set, process exits |  A  |
	* |   ✓    |    -     |   ✓   |    *    |  ✓   | update                                      |  B   |
	* |   ✓    |    -     |   ✓   |    *    |  -   | verify, refresh                             |  C   |
	* |   ✓    |    -     |   -   |    *    |  -   | activate                                     |  D  |
	* |   -    |    ✓     |   *   |    *    |  -   | verify offline token, cleanup DB             |  E   |
	* |   -    |    -     |   ✓   |    ✓    |  -   | verify token + refresh                       |  F  |
	* |   -    |    -     |   ✓   |    -    |  -   | activate                                     |  G   |
	* |   -    |    -     |   -   |    ✓    |  -   | cleanup and CORE_LICENSE                     |  H   |
	* |   -    |    -     |   -   |    -    |  -   |  CORE_LICENSE                                |  I   |
	*/
	async initialize() {
		const existingStore = this.store;
		getEntitlementManager();
		try {
			await this.store(async (store) => {
				this.store = (cb) => {
					return cb(store);
				};
				const envKey = env["LICENSE_KEY"];
				const envToken = env["LICENSE_TOKEN"];
				if (envKey && envToken) {
					logger.fatal("LICENSE_KEY and LICENSE_TOKEN cannot both be set. Provide one or the other.");
					process.exit(1);
				}
				const settingsService = new SettingsService({ schema: await getSchema() });
				const { license_key: dbKey, license_token: dbToken } = await settingsService.readSingleton({ fields: ["license_key", "license_token"] });
				if (envKey) try {
					this.source = "env";
					if (!dbKey) await this.activate(envKey);
					else if (envKey !== dbKey) await this.update(envKey, { oldKey: dbKey });
					else await this.refresh({
						key: envKey,
						token: dbToken ?? null
					});
				} catch (error) {
					logger.fatal("Unable to validate the LICENSE_KEY, please check the key and try again.");
					logger.fatal(error);
					process.exit(1);
				}
				else if (envToken) try {
					this.source = "env";
					await this.refresh({ token: envToken });
					if (dbKey || dbToken) await settingsService.upsertSingleton({
						license_key: null,
						license_token: null
					});
				} catch (error) {
					logger.fatal("Unable to validate the LICENSE_TOKEN, please check the token and try again.");
					logger.fatal(error);
					process.exit(1);
				}
				else if (dbKey) try {
					this.source = "settings";
					if (dbToken) await this.refresh({
						key: dbKey,
						token: dbToken
					});
					else await this.activate(dbKey);
				} catch (error) {
					logger.error("Unable to validate the license key from the database, downgrading to core tier.");
					logger.error(error);
					await this.syncLicense({ kind: "downgrade" });
				}
				else if (dbToken) await this.syncLicense({ kind: "downgrade" });
				else await this.syncLicense();
				this.initialized = true;
			});
		} finally {
			this.store = existingStore;
		}
	}
	async getLicense(options) {
		if (licenseCache) return licenseCache;
		const { token } = await getLicenseToken(options);
		if (!token) {
			this.source = null;
			licenseCache = CORE_LICENSE;
		} else {
			licenseCache = await this.verify(token);
			if (!licenseCache) {
				this.source = null;
				licenseCache = CORE_LICENSE;
			}
		}
		return licenseCache;
	}
	async getStatus() {
		return computeLicenseStatus(this.source === null ? null : await this.getLicense());
	}
	async getDowngradeReason() {
		return await this.store(async (store) => store.get("invalidStatus")) ?? null;
	}
	getSource() {
		return this.source;
	}
	/**
	* Throw if the current license cannot have its key changed (activate / update / deactivate).
	*
	* License management is only allowed for setting-based licenses
	*/
	assertCanManageLicense() {
		if (this.initialized && this.source !== "settings") throw new ForbiddenError({ reason: `You cannot manage license for the current license.` });
	}
	/**
	* Throw if the current license cannot have its entitlements changed (e.g. adding addons).
	*
	* Addons are supported for all licenses except core and offline.
	*/
	assertCanManageAddons() {
		if (this.source === null || this.licenseKey === null) throw new ForbiddenError({ reason: `You cannot manage addons for the current license.` });
	}
	async isLocked() {
		return await this.getStatus() === "locked";
	}
	/**
	*  Check a license meta/info without activating it
	*/
	async preview(key) {
		try {
			return await previewKey({ license_key: key });
		} catch (err) {
			handleLicenseError(err);
		}
	}
	/**
	* Activates a new license
	*/
	async activate(key) {
		if (this.source !== null) this.assertCanManageLicense();
		if (this.licenseKey) throw new ForbiddenError({ reason: "A license was already activated" });
		const settingsService = new SettingsService({ schema: await getSchema() });
		const { project_id } = await settingsService.readSingleton({ fields: ["project_id"] });
		try {
			const { token, new_project_id } = await activateKey({
				license_key: key,
				project_id,
				public_url: env["PUBLIC_URL"]
			});
			await settingsService.upsertSingleton({
				license_key: key,
				license_token: token,
				project_id: new_project_id ?? project_id
			});
			if (this.initialized) this.source = "settings";
			await this.syncLicense();
			if (this.initialized) await schedule();
		} catch (err) {
			if (err instanceof LicenseServerError) handleLicenseError(err);
			throw err;
		}
	}
	async deactivate(key) {
		this.assertCanManageLicense();
		const currentKey = key ?? this.licenseKey;
		if (!currentKey) throw new InvalidPayloadError({ reason: "\"key\" has to be defined in order to deactivate" });
		const { project_id } = await new SettingsService({ schema: await getSchema() }).readSingleton({ fields: ["project_id"] });
		try {
			await deactivateKey({
				license_key: currentKey,
				project_id,
				public_url: env["PUBLIC_URL"]
			});
			await this.syncLicense({ kind: "downgrade" });
		} catch (err) {
			if (err instanceof LicenseServerError) handleLicenseError(err);
			throw err;
		}
	}
	/**
	* Update from an existing key to a new key
	*/
	async update(newKey, options) {
		this.assertCanManageLicense();
		const currentKey = options?.oldKey ?? this.licenseKey;
		if (!currentKey) throw new InvalidPayloadError({ reason: "A current license must be provided in order to update" });
		const settingsService = new SettingsService({ schema: await getSchema() });
		const { project_id } = await settingsService.readSingleton({ fields: ["project_id"] });
		try {
			const { token } = await updateKey({
				license_key: currentKey,
				project_id,
				public_url: env["PUBLIC_URL"]
			}, { license_key: newKey });
			await settingsService.upsertSingleton({
				license_key: newKey,
				license_token: token,
				project_id
			});
			await this.syncLicense();
		} catch (err) {
			if (err instanceof LicenseServerError) handleLicenseError(err);
			throw err;
		}
	}
	async verify(token) {
		try {
			return await verifyLicense(token);
		} catch {
			return null;
		}
	}
	/**
	* Verify a license token. On failure, downgrade and mark status 'expired'.
	*/
	async refresh(options) {
		const key = options?.key ?? this.licenseKey;
		const token = options?.token ?? this.licenseToken;
		let license = null;
		if (token) {
			license = await this.verify(token);
			if (!license) {
				await this.syncLicense({
					kind: "downgrade",
					reason: "expired"
				});
				return;
			}
		}
		if (license?.meta.offline === false) {
			if (!key) throw new InvalidPayloadError({ reason: "A \"key\" is required" });
			const entitlementManager = getEntitlementManager();
			const settingsService = new SettingsService({ schema: await getSchema() });
			const { project_id } = await settingsService.readSingleton({ fields: ["project_id"] });
			const refreshPayload = { usage_metrics: {
				seats: await entitlementManager.getUsage("seats"),
				collections: await entitlementManager.getUsage("collections"),
				flows: await entitlementManager.getUsage("flows")
			} };
			try {
				const { token: token$1 } = await refreshLicense({
					license_key: key,
					project_id,
					public_url: env["PUBLIC_URL"]
				}, refreshPayload);
				await settingsService.upsertSingleton({ license_token: token$1 });
			} catch (err) {
				logger.error(err);
				if (err instanceof LicenseServerError) {
					if (err.code === "LICENSE_EXPIRED") await this.syncLicense({
						kind: "downgrade",
						reason: "expired"
					});
					else if (err.code === "LICENSE_CANCELED") await this.syncLicense({
						kind: "downgrade",
						reason: "canceled"
					});
					else if (err.code === "LICENSE_SUSPENDED") await this.syncLicense({
						kind: "downgrade",
						reason: "suspended"
					});
				}
			}
		}
		await this.syncLicense();
	}
	async billingPortalUrl() {
		this.assertCanManageAddons();
		const { project_id } = await new SettingsService({ schema: await getSchema() }).readSingleton({ fields: ["project_id"] });
		try {
			const { url } = await billingPortal({
				license_key: this.licenseKey,
				project_id,
				public_url: env["PUBLIC_URL"]
			});
			return url;
		} catch (err) {
			handleLicenseError(err);
		}
	}
	async availableAddons() {
		this.assertCanManageAddons();
		const { project_id } = await new SettingsService({ schema: await getSchema() }).readSingleton({ fields: ["project_id"] });
		try {
			return (await readAddons({
				license_key: this.licenseKey,
				project_id,
				public_url: env["PUBLIC_URL"]
			})).available_addons.map((addon) => ({
				id: addon.id,
				name: addon.name,
				description: addon.description,
				icon: addon.icon,
				unit_price: addon.unit_price,
				billing_interval: addon.billing_interval,
				upgrade_required: addon.upgrade_required,
				pricing_summary: addon.pricing_summary,
				min_quantity: addon.min_quantity,
				max_quantity: addon.max_quantity,
				active_quantity: addon.active_quantity,
				scheduled_quantity: addon.scheduled_quantity
			}));
		} catch (err) {
			handleLicenseError(err);
		}
	}
	async setAddonQuantity(options) {
		this.assertCanManageAddons();
		const settingsService = new SettingsService({ schema: await getSchema() });
		const { project_id } = await settingsService.readSingleton({ fields: ["project_id"] });
		const entitlementManager = getEntitlementManager();
		try {
			const { token } = await updateAddonQuantity({
				license_key: this.licenseKey,
				project_id,
				public_url: env["PUBLIC_URL"]
			}, {
				addons: [{
					addon_id: options.addonId,
					quantity: options.quantity
				}],
				usage_metrics: {
					seats: await entitlementManager.getUsage("seats"),
					collections: await entitlementManager.getUsage("collections"),
					flows: await entitlementManager.getUsage("flows")
				}
			});
			await settingsService.upsertSingleton({ license_token: token });
			await this.syncLicense();
		} catch (err) {
			if (err instanceof LicenseServerError) handleLicenseError(err);
			throw err;
		}
	}
	async removeAddon(addonId) {
		this.assertCanManageAddons();
		const { project_id } = await new SettingsService({ schema: await getSchema() }).readSingleton({ fields: ["project_id"] });
		try {
			await deleteAddon({
				license_key: this.licenseKey,
				project_id,
				public_url: env["PUBLIC_URL"]
			}, { addon_ids: [addonId] });
		} catch (err) {
			handleLicenseError(err);
		}
	}
	/**
	* Retrieve entitlements that are pending resolution
	*
	* If no entitlements to resolve, an empty array will be returned
	*/
	async pendingResolution(options) {
		const schema = await getSchema();
		const pendingResolution = [];
		let entitlements;
		if (options.licenseKey) entitlements = (await this.preview(options.licenseKey)).entitlements;
		else if (options.licenseKey === null) entitlements = null;
		else entitlements = (await this.getLicense()).entitlements;
		const entitlementManager = new EntitlementManager();
		entitlementManager.setEntitlements(entitlements);
		const candidateGetters = {
			seats: getActiveSeats,
			collections: getActiveCollections,
			flows: getActiveFlows
		};
		for (const check of COUNTABLE_ENTITLEMENT_KEYS) {
			const resolution = await entitlementManager.check(check);
			if (resolution.allowed === false) {
				const candidates = await candidateGetters[check]({ adminId: options.adminId });
				pendingResolution.push({
					key: check,
					kind: "limit",
					limit: resolution.hardLimit,
					usage: resolution.usage,
					candidates
				});
			}
		}
		if ((await entitlementManager.check("sso_enabled")).valid === false) {
			const adminUser = await new UsersService({ schema }).readOne(options.adminId, { fields: ["email", "password"] });
			const blockers = [];
			if (adminUser["email"] === null) blockers.push("ADMIN_MISSING_EMAIL");
			if (adminUser["password"] === null) blockers.push("ADMIN_MISSING_PASSWORD");
			pendingResolution.push({
				key: "sso_enabled",
				kind: "feature_gate",
				blockers
			});
		}
		if ((await entitlementManager.check("custom_llms_enabled")).valid === false) pendingResolution.push({
			key: "custom_llms_enabled",
			kind: "feature_gate"
		});
		if ((await entitlementManager.check("custom_permission_rules_enabled")).valid === false) pendingResolution.push({
			key: "custom_permission_rules_enabled",
			kind: "feature_gate"
		});
		return pendingResolution;
	}
	/**
	* Apply a resolution strategy
	*
	* Allows partial resolution
	*/
	async applyResolution(resolution, ctx) {
		const entitlementManager = getEntitlementManager();
		const cachesToClear = [];
		if (resolution.collections && resolution.collections.length > 0) {
			await entitlementManager.resolve("collections", resolution.collections, { accountability: ctx?.accountability });
			cachesToClear.push("collections");
		}
		if (resolution.seats && resolution.seats.length > 0) {
			await entitlementManager.resolve("seats", resolution.seats, { accountability: ctx?.accountability });
			cachesToClear.push("seats");
		}
		if (resolution.flows && resolution.flows.length > 0) {
			await entitlementManager.resolve("flows", resolution.flows, { accountability: ctx?.accountability });
			cachesToClear.push("flows");
		}
		/**
		* Set all sso users to disabled and optional set the current admin email and password
		*/
		if (resolution.sso_enabled) {
			await entitlementManager.resolve("sso_enabled", resolution.sso_enabled, { accountability: ctx?.accountability });
			if (!cachesToClear.includes("seats")) cachesToClear.push("seats");
			cachesToClear.push("sso_enabled");
		}
		if (cachesToClear.length > 0) await entitlementManager.clearCache(...cachesToClear);
		if (await entitlementManager.checkAll()) await this.syncLicense({ kind: "clear-status" });
	}
	/**
	* Apply a state transition and propagate to all instances.
	*
	*  - { kind: 'downgrade', reason? }: clear key + token, drop to core, propagate.
	*  - { kind: 'clear-token' }: clear only the token; key survives for re-activation. Marker preserved (server's verdict still applies). Propagates.
	*  - { kind: 'clear-status' }: clear the invalidStatus marker only. Redis-only, does NOT propagate.
	*/
	async syncLicense(options) {
		if (options?.kind !== "downgrade" || options?.kind === "downgrade" && options.reason === void 0) {
			await this.store(async (store) => store.delete("invalidStatus"));
			if (options?.kind === "clear-status") return;
		}
		if (options?.kind === "downgrade") {
			await new SettingsService({ schema: await getSchema() }).upsertSingleton({
				license_key: null,
				license_token: null
			});
			this.source = null;
			await stopLicenseCheck();
			if (options.reason) await this.store(async (store) => store.set("invalidStatus", options.reason));
		} else if (options?.kind === "clear-token") await new SettingsService({ schema: await getSchema() }).upsertSingleton({ license_token: null });
		await clearCache();
		await this.syncState({ source: this.source });
		await this.rpc.syncState({ source: this.source });
	}
	async syncState(options) {
		const { key } = await getLicenseKey();
		const { token } = await getLicenseToken();
		this.licenseKey = key;
		this.licenseToken = token;
		this.initialized = true;
		if (options && "source" in options) this.source = options.source;
		licenseCache = null;
		const license = await this.getLicense();
		getEntitlementManager().setEntitlements(license.entitlements);
	}
};

//#endregion
export { LicenseManager, getLicenseManager };