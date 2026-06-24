import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { countActiveCollections, resolveCollections } from "./lib/collections.js";
import { checkCustomLLM } from "./lib/custom-llms-enabled.js";
import { checkCustomPermissionRules } from "./lib/custom-permission-rules-enabled.js";
import { countActiveFlows, resolveFlows } from "./lib/flows.js";
import { countActiveSeats, resolveSeats } from "./lib/seats.js";
import { checkUsersSSO, resolveSSOUsers } from "./lib/sso-enabled.js";
import { LimitExceededError, ResourceRestrictedError } from "@directus/errors";
import { CORE_LICENSE, COUNTABLE_ENTITLEMENT_KEYS, FEATURE_FLAG_ENTITLEMENT_KEYS } from "@directus/license";

//#region src/license/entitlements/manager.ts
const BUS_CHANNEL = "entitlements.invalidate";
let entitlementManager;
function getEntitlementManager() {
	if (!entitlementManager) entitlementManager = new EntitlementManager();
	return entitlementManager;
}
var EntitlementManager = class EntitlementManager {
	entitlements = CORE_LICENSE["entitlements"];
	counterSources = /* @__PURE__ */ new Map();
	validatorSources = /* @__PURE__ */ new Map();
	resolverSources = /* @__PURE__ */ new Map();
	cache = /* @__PURE__ */ new Map();
	initialized = false;
	constructor() {
		this.registerHandlers();
	}
	registerHandlers() {
		this.registerCounter("collections", countActiveCollections);
		this.registerCounter("seats", countActiveSeats);
		this.registerCounter("flows", countActiveFlows);
		this.registerValidator("sso_enabled", checkUsersSSO);
		this.registerValidator("custom_llms_enabled", checkCustomLLM);
		this.registerValidator("custom_permission_rules_enabled", checkCustomPermissionRules);
		this.registerResolver("collections", resolveCollections);
		this.registerResolver("seats", resolveSeats);
		this.registerResolver("flows", resolveFlows);
		this.registerResolver("sso_enabled", resolveSSOUsers);
	}
	initialize() {
		if (this.initialized) return;
		this.initialized = true;
		useBus().subscribe(BUS_CHANNEL, async (msg) => {
			this.clearCacheNoPublish(...msg?.keys ?? []);
		});
	}
	/**
	* Replace the active license. Pass `null` to reset to the core license.
	*/
	setEntitlements(entitlements) {
		this.entitlements = entitlements ?? CORE_LICENSE["entitlements"];
		this.clearCache();
	}
	/**
	* Create a manager that uses a different entitlement set while sharing
	* this instance's cache and registered sources. Used to preview how a
	* license change would affect the current user. Intended for read-only
	* checks. Mutating methods (`setEntitlements`, `clearCache`) on the
	* fork will affect the shared cache.
	*/
	fork(entitlements) {
		const forked = Object.create(EntitlementManager.prototype);
		forked.entitlements = entitlements ?? CORE_LICENSE["entitlements"];
		forked.counterSources = this.counterSources;
		forked.validatorSources = this.validatorSources;
		forked.resolverSources = this.resolverSources;
		forked.cache = this.cache;
		return forked;
	}
	clearCacheNoPublish(...keys) {
		if (keys.length === 0) this.cache.clear();
		else for (const key of keys) this.cache.delete(key);
	}
	/**
	* Drop cached usage/validity locally and notify other nodes. Pass specific
	* keys to clear only those entries; call with no args to clear everything.
	* Used by mutation paths (services) and by the manual cache-clear endpoint
	* and CLI command.
	*/
	async clearCache(...keys) {
		this.clearCacheNoPublish(...keys);
		if (this.initialized) await useBus().publish(BUS_CHANNEL, { keys });
	}
	/**
	* Returns a cached value by key
	*/
	getCached(key) {
		return this.cache.get(key);
	}
	/**
	* Returns whether a feature flag is enabled, applying `override` when
	* present and falling back to `default` otherwise.
	*/
	isEntitled(key) {
		const entitlement = this.entitlements[key];
		return entitlement.override ?? entitlement.default;
	}
	/**
	* Wire up a validator function for a feature flag entitlement.
	*/
	registerValidator(key, validator) {
		if (this.validatorSources.has(key)) throw new Error(`Validator was already registered for entitlement "${String(key)}"`);
		this.validatorSources.set(key, validator);
	}
	/**
	* Resolve the validity of a feature flag by invoking its registered
	* validator. Throws if no validator has been registered for `key`.
	*/
	async isValid(key, opts) {
		const validator = this.validatorSources.get(key);
		if (!validator) throw new Error(`No validator registered for entitlement "${String(key)}"`);
		if (opts?.knex?.isTransaction) return await validator(opts);
		let cached = this.cache.get(key);
		if (typeof cached !== "boolean") {
			cached = await validator(opts);
			this.cache.set(key, cached);
		}
		return cached;
	}
	/**
	* Returns the resolved values of app-only entitlements as a single bundle
	* for exposure to the client. The package does not enforce these — the app
	* uses them to adapt its UI (production indicator, powered-by branding).
	*/
	getAppEntitlements() {
		const { production_enabled, display_powered_by, ai_translations_enabled } = this.entitlements;
		return {
			production_enabled: production_enabled.override ?? production_enabled.default,
			ai_translations_enabled: ai_translations_enabled.override ?? ai_translations_enabled.default,
			display_powered_by
		};
	}
	/**
	* Returns the effective hard limit (`limit + overage + addon`) for a numeric
	* entitlement with `-1` denoting unlimited
	*/
	getEntitlementLimit(key) {
		const { limit, overage, addon } = this.entitlements[key];
		if (limit === -1 || overage === -1 || addon === -1) return -1;
		return limit + (overage ?? 0) + (addon ?? 0);
	}
	/**
	* Wire up a usage counter function for a countable entitlement.
	*/
	registerCounter(key, source) {
		if (this.counterSources.has(key)) throw new Error(`Counter was already registered for entitlement "${String(key)}"`);
		this.counterSources.set(key, source);
	}
	/**
	* Wire up a resolver function for an entitlement.
	*/
	registerResolver(key, source) {
		if (this.resolverSources.has(key)) throw new Error(`Resolver was already registered for entitlement "${String(key)}"`);
		this.resolverSources.set(key, source);
	}
	/**
	* Resolve current usage for a countable entitlement by invoking the
	* registered source. Throws if no source has been registered for `key`.
	*/
	async getUsage(key, opts) {
		const source = this.counterSources.get(key);
		if (!source) throw new Error(`No usage source registered for entitlement "${String(key)}"`);
		if (opts?.knex?.isTransaction) return await source(opts);
		let cached = this.cache.get(key);
		if (typeof cached !== "number") {
			cached = await source(opts);
			this.cache.set(key, cached);
		}
		return cached;
	}
	async check(key, opts) {
		if (this.isCountableKey(key)) {
			const hardLimit = this.getEntitlementLimit(key);
			if (hardLimit === -1) return {
				allowed: true,
				hardLimit: -1,
				usage: 0,
				remaining: null
			};
			const usage = await this.getUsage(key, { knex: opts?.knex });
			const adding = opts?.adding ?? 0;
			const removing = opts?.removing ?? 0;
			return {
				allowed: usage + adding - removing <= hardLimit,
				hardLimit,
				usage,
				remaining: hardLimit - usage
			};
		}
		const entitled = this.isEntitled(key);
		if (!entitled) return {
			valid: await this.isValid(key, { knex: opts?.knex }),
			entitled
		};
		else return {
			valid: true,
			entitled
		};
	}
	async assert(key, opts) {
		if (this.isCountableKey(key)) {
			const hardLimit = this.getEntitlementLimit(key);
			if (hardLimit === -1) return;
			const adding = opts?.adding ?? 0;
			const removing = opts?.removing ?? 0;
			if (await this.getUsage(key, { knex: opts?.knex }) + adding - removing > hardLimit) throw new LimitExceededError({ category: key });
			return;
		}
		if (!this.isEntitled(key) && !await this.isValid(key, { knex: opts?.knex })) throw new ResourceRestrictedError({ category: key });
	}
	/**
	* Checks all entitlements and returns true if all are within the limits
	*/
	async checkAll(opts) {
		for (const key of COUNTABLE_ENTITLEMENT_KEYS) {
			if (!this.counterSources.has(key)) continue;
			const { allowed } = await this.check(key, opts);
			if (!allowed) return false;
		}
		for (const key of FEATURE_FLAG_ENTITLEMENT_KEYS) {
			if (!this.validatorSources.has(key) || !this.resolverSources.has(key)) continue;
			const { valid } = await this.check(key, opts);
			if (!valid) return false;
		}
		return true;
	}
	/**
	* Asserts all entitlements and throws if a limit is breached
	*/
	async assertAll(opts) {
		for (const key of COUNTABLE_ENTITLEMENT_KEYS) {
			if (!this.counterSources.has(key)) continue;
			await this.assert(key, opts);
		}
		for (const key of FEATURE_FLAG_ENTITLEMENT_KEYS) {
			if (!this.validatorSources.has(key)) continue;
			await this.assert(key, opts);
		}
	}
	/**
	* Apply a resolution payload to an entitlement by invoking its registered
	* resolver
	*/
	async resolve(key, input, ctx) {
		const source = this.resolverSources.get(key);
		if (!source) throw new Error(`No resolver registered for entitlement "${String(key)}"`);
		await source(input, ctx);
	}
	isCountableKey(key) {
		return COUNTABLE_ENTITLEMENT_KEYS.includes(key);
	}
};

//#endregion
export { EntitlementManager, getEntitlementManager };