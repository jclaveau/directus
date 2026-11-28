//#region src/scalabus/refuse-invalid-extension-env-vars.ts
const ENV_VAR_PREFIX_REGEX = /^[A-Z][A-Z0-9]*_$/;
/**
* Throws when `prefix` is malformed, or a variable ends in "_" or is not
* named under it.
*/
function refuseInvalidExtensionEnvVars({ prefix, vars }) {
	if (!ENV_VAR_PREFIX_REGEX.test(prefix)) throw new Error(`Env prefix ${JSON.stringify(prefix)} must be upper case, with one "_" at its end, like "SUBSCRIPTIONS_"`);
	for (const envVarName of Object.keys(vars)) {
		if (envVarName.endsWith("_")) throw new Error(`Env variable ${JSON.stringify(envVarName)} must not end with "_"`);
		if (!envVarName.startsWith(prefix)) throw new Error(`Env variable ${JSON.stringify(envVarName)} is not named under its prefix ${JSON.stringify(prefix)}`);
	}
}

//#endregion
export { refuseInvalidExtensionEnvVars };