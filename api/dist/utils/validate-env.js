import { getMilliseconds } from "./get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { useEnv } from "@directus/env";
import { parse } from "bytes";
import { validateHeaderName } from "node:http";

//#region src/utils/validate-env.ts
function validateEnv(requiredKeys) {
	const env = useEnv();
	const logger = useLogger();
	for (const requiredKey of requiredKeys) if (requiredKey in env === false) {
		logger.error(`"${requiredKey}" Environment Variable is missing.`);
		process.exit(1);
	}
}
/**
* What `toBoolean` reads as a boolean, spelled the ways an environment spells
* one.
*/
const BOOLEANS = [
	"true",
	"false",
	"1",
	"0"
];
/**
* Refuse a boolean variable set to something that is not one.
*
* `toBoolean` reads anything outside {@link BOOLEANS} as `false`, so a
* deployment that meant `TRUE` turns a feature off and says nothing — and
* `PM2_AUTOSCALE_ENABLED` turning off silently is a pool that never grows
* under a load it was sized to answer.
*
* Read off `process.env` rather than off `useEnv`, which is where the cast has
* already happened: by then a typo and a deliberate `false` are the same
* value. A configuration file may hold a real boolean, and that is not read
* here — a variable is a string, and a string is where the typo lands.
*
* Ends the process like the check above it: the value is read once at boot, so
* refusing it costs a deployment that is already misconfigured, while taking
* it costs an incident nobody can see the cause of.
*/
function validateBooleanEnv(keys) {
	const logger = useLogger();
	for (const key of keys) {
		const value = process.env[key];
		if (value === void 0 || BOOLEANS.includes(value)) continue;
		logger.error(`"${key}" Environment Variable is ${JSON.stringify(value)}, which is not a boolean. Use one of ${BOOLEANS.join(", ")}.`);
		process.exit(1);
	}
}
/**
* Refuse a duration variable that is not a duration of 0 or more, the way
* {@link validateBooleanEnv} refuses a boolean: at boot, before the server
* listens, so a deployment carrying one fails its healthcheck and the one
* before keeps the traffic.
*
* Read off `useEnv`, so an unset variable takes its default. `ms` reads a value
* over 100 characters, 401 digits included, as none.
*/
function validateDurationEnv(keys) {
	const env = useEnv();
	const logger = useLogger();
	for (const key of keys) {
		const parsedMs = getMilliseconds(env[key]);
		if (parsedMs !== void 0 && parsedMs >= 0) continue;
		logger.error(`"${key}" Environment Variable is ${JSON.stringify(env[key])}, which is not a duration of 0 or more.`);
		process.exit(1);
	}
}
/**
* A number of bytes, or of a unit `bytes` knows. Checked before parsing:
* `bytes` reads what follows the leading digits as nothing, `16k` as 16.
*/
const SIZE_PATTERN = /^\d+(?:\.\d+)?\s*(?:b|kb|mb|gb|tb|pb)?$/i;
/**
* Refuse a size variable that is not a size of 0 or more, nor 0 or
* `nonzeroMinimum` bytes or more when given, at boot like
* {@link validateDurationEnv}. Read off `useEnv`, so an unset variable takes its
* default.
*/
function validateBytesEnv(keys, nonzeroMinimum = 0) {
	const env = useEnv();
	const logger = useLogger();
	for (const key of keys) {
		const sizeValue = String(env[key]);
		const parsedBytes = SIZE_PATTERN.test(sizeValue) ? parse(sizeValue) : null;
		if (parsedBytes === null) {
			logger.error(`"${key}" Environment Variable is ${JSON.stringify(env[key])}, which is not a size of 0 or more.`);
			process.exit(1);
		} else if (parsedBytes > 0 && parsedBytes < nonzeroMinimum) {
			logger.error(`"${key}" Environment Variable is ${JSON.stringify(env[key])}, which is neither 0 nor a size of ${nonzeroMinimum} bytes or more.`);
			process.exit(1);
		}
	}
}
/**
* Refuse a variable set to none of `choices`, at boot like
* {@link validateDurationEnv}. Read off `useEnv`, so an unset variable takes its
* default.
*/
function validateChoiceEnv(key, choices) {
	const env = useEnv();
	if (choices.includes(env[key])) return;
	useLogger().error(`"${key}" Environment Variable is ${JSON.stringify(env[key])}, which is not one of ${choices.join(", ")}.`);
	process.exit(1);
}
/**
* Refuse a variable naming a response header Node cannot write, which would
* otherwise fail every response, at boot like {@link validateDurationEnv}. A
* boolean is refused too: the variable turns its feature on by being set, so
* `false` would turn it on under a header named `false`.
*/
function validateHeaderNameEnv(key) {
	const env = useEnv();
	if (BOOLEANS.includes(String(env[key]).toLowerCase())) {
		useLogger().error(`"${key}" Environment Variable is ${JSON.stringify(env[key])}, which reads as a boolean, not a header name: leave it unset to send none.`);
		process.exit(1);
	}
	try {
		validateHeaderName(String(env[key]));
	} catch {
		useLogger().error(`"${key}" Environment Variable is ${JSON.stringify(env[key])}, which is not a valid header name.`);
		process.exit(1);
	}
}

//#endregion
export { validateBooleanEnv, validateBytesEnv, validateChoiceEnv, validateDurationEnv, validateEnv, validateHeaderNameEnv };