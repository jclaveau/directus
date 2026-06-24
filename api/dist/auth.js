import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { useLogger } from "./logger/index.js";
import { DEFAULT_AUTH_PROVIDER } from "./constants.js";
import database_default from "./database/index.js";
import { getEntitlementManager } from "./license/entitlements/manager.js";
import { LocalAuthDriver } from "./auth/drivers/local.js";
import { OAuth2AuthDriver } from "./auth/drivers/oauth2.js";
import { OpenIDAuthDriver } from "./auth/drivers/openid.js";
import { LDAPAuthDriver } from "./auth/drivers/ldap.js";
import { SAMLAuthDriver } from "./auth/drivers/saml.js";
import "./auth/drivers/index.js";
import "./license/index.js";
import { useEnv } from "@directus/env";
import { InvalidProviderConfigError } from "@directus/errors";
import { toArray, toBoolean } from "@directus/utils";

//#region src/auth.ts
const providers = /* @__PURE__ */ new Map();
function getAuthProvider(provider) {
	const logger = useLogger();
	if (!providers.has(provider)) {
		logger.error("Auth provider not configured");
		throw new InvalidProviderConfigError({ provider });
	}
	return providers.get(provider);
}
async function registerAuthProviders() {
	const env = useEnv();
	const logger = useLogger();
	const options = { knex: database_default() };
	const providerNames = toArray(env["AUTH_PROVIDERS"]);
	const sso_allowed = getEntitlementManager().isEntitled("sso_enabled");
	if (sso_allowed === false && env["AUTH_PROVIDERS"] && providerNames.length > 0) logger.warn("you have SSO providers configured these will be unavailable under the current license tier");
	if (sso_allowed === false && toBoolean(env["AUTH_DISABLE_DEFAULT"])) logger.warn("you cannot disable the default auth provider under the current license tier");
	const defaultProvider = getProviderInstance("local", options);
	providers.set(DEFAULT_AUTH_PROVIDER, defaultProvider);
	if (!env["AUTH_PROVIDERS"]) return;
	providerNames.forEach((name) => {
		name = name.trim();
		if (name === DEFAULT_AUTH_PROVIDER) {
			logger.error(`Cannot override "${DEFAULT_AUTH_PROVIDER}" auth provider.`);
			process.exit(1);
		}
		const { driver,...config } = getConfigFromEnv(`AUTH_${name.toUpperCase()}_`);
		if (!driver) {
			logger.warn(`Missing driver definition for "${name}" auth provider.`);
			return;
		}
		const provider = getProviderInstance(driver, options, {
			provider: name,
			...config
		});
		if (!provider) {
			logger.warn(`Invalid "${driver}" auth driver.`);
			return;
		}
		providers.set(name, provider);
	});
}
function getProviderInstance(driver, options, config = {}) {
	switch (driver) {
		case "local": return new LocalAuthDriver(options, config);
		case "oauth2": return new OAuth2AuthDriver(options, config);
		case "openid": return new OpenIDAuthDriver(options, config);
		case "ldap": return new LDAPAuthDriver(options, config);
		case "saml": return new SAMLAuthDriver(options, config);
	}
}

//#endregion
export { getAuthProvider, registerAuthProviders };