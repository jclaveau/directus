import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";
import { set } from "lodash-es";
import camelcase from "camelcase";

//#region src/utils/get-config-from-env.ts
function getConfigFromEnv(prefix, options) {
	const env = useEnv();
	const type = options?.type ?? "camelcase";
	const config = {};
	const lowerCasePrefix = prefix.toLowerCase();
	const omitKeys = toArray(options?.omitKey ?? []).map((key) => key.toLowerCase());
	const omitPrefixes = toArray(options?.omitPrefix ?? []).map((prefix$1) => prefix$1.toLowerCase());
	for (const [key, value] of Object.entries(env)) {
		const lowerCaseKey = key.toLowerCase();
		if (lowerCaseKey.startsWith(lowerCasePrefix) === false) continue;
		if (omitKeys.length > 0) {
			if (omitKeys.some((keyToOmit) => lowerCaseKey === keyToOmit)) continue;
		}
		if (omitPrefixes.length > 0) {
			if (omitPrefixes.some((prefix$1) => lowerCaseKey.startsWith(prefix$1))) continue;
		}
		if (key.includes("__")) set(config, key.split("__").map((key$1, index) => index === 0 ? transform$1(transform$1(key$1.slice(prefix.length))) : transform$1(key$1)).join("."), value);
		else config[transform$1(key.slice(prefix.length))] = value;
	}
	return config;
	function transform$1(key) {
		if (type === "camelcase") return camelcase(key, { locale: false });
		else if (type === "underscore") return key.toLowerCase();
		return key;
	}
}

//#endregion
export { getConfigFromEnv };