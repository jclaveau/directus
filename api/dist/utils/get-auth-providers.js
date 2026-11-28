import { useEnv } from "@directus/env";

//#region src/utils/get-auth-providers.ts
function getAuthProviders({ sessionOnly } = { sessionOnly: false }) {
	const env = useEnv();
	let providers = env["AUTH_PROVIDERS"].filter((provider) => provider && env[`AUTH_${provider.toUpperCase()}_DRIVER`]);
	if (sessionOnly) providers = providers.filter((provider) => {
		const driver = env[`AUTH_${provider.toUpperCase()}_DRIVER`];
		if ([
			"oauth2",
			"openid",
			"saml"
		].includes(driver)) {
			const mode = env[`AUTH_${provider.toUpperCase()}_MODE`];
			return !mode || mode === "session";
		}
		return true;
	});
	return providers.map((provider) => ({
		name: provider,
		label: env[`AUTH_${provider.toUpperCase()}_LABEL`],
		driver: env[`AUTH_${provider.toUpperCase()}_DRIVER`],
		icon: env[`AUTH_${provider.toUpperCase()}_ICON`]
	}));
}

//#endregion
export { getAuthProviders };