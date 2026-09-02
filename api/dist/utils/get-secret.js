import { useEnv } from "@directus/env";
import { nanoid } from "nanoid";

//#region src/utils/get-secret.ts
const _cache = { secret: null };
const getSecret = () => {
	if (_cache.secret) return _cache.secret;
	const env = useEnv();
	if (env["SECRET"]) return env["SECRET"];
	_cache.secret = nanoid(32);
	return _cache.secret;
};

//#endregion
export { _cache, getSecret };