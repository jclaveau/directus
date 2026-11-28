import { refuseInvalidExtensionEnvVars } from "./refuse-invalid-extension-env-vars.js";
import { defineEndpoint, defineHook, defineMigration, defineOperationApi } from "./define-entry.js";

//#region src/scalabus/define-env.ts
/**
* Declare the variables an extension reads, for the API to check at boot and
* cast as declared, and get back the entry helpers whose `context.env` knows
* their types.
* For bundles only: a standalone extension casts what it reads off `env` itself.
*
* ```ts
* const subscriptionsEnv = defineEnv({
* 	prefix: 'SUBSCRIPTIONS_',
* 	vars: { SUBSCRIPTIONS_TRIAL_DAYS: { type: 'number', default: 14 } },
* });
*
* subscriptionsEnv.defineHook('trials', (register, { env }) => {
* 	env.SUBSCRIPTIONS_TRIAL_DAYS; // number
* });
* ```
*/
function defineEnv(extensionEnv) {
	const { prefix, vars } = extensionEnv;
	refuseInvalidExtensionEnvVars(extensionEnv);
	const declaredEnvVars = {
		prefix,
		vars
	};
	const stampEnvVars = (entry) => {
		return {
			...entry,
			env: declaredEnvVars
		};
	};
	return {
		prefix,
		vars,
		defineHook: (name, config) => {
			return stampEnvVars(defineHook(name, config));
		},
		defineEndpoint: (name, config) => {
			return stampEnvVars(defineEndpoint(name, config));
		},
		defineOperationApi: (name, config) => {
			return stampEnvVars(defineOperationApi(name, config));
		},
		defineMigration: (name, config) => {
			return stampEnvVars(defineMigration(name, config));
		}
	};
}

//#endregion
export { defineEnv };