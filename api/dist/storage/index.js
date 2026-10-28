import { validateEnv } from "../utils/validate-env.js";
import { registerDrivers } from "./register-drivers.js";
import { registerLocations } from "./register-locations.js";

//#region src/storage/index.ts
const _cache = { storage: null };
const getStorage = async () => {
	if (_cache.storage) return _cache.storage;
	const { StorageManager } = await import("@directus/storage");
	validateEnv(["STORAGE_LOCATIONS"]);
	const storage = new StorageManager();
	await registerDrivers(storage);
	await registerLocations(storage);
	_cache.storage = storage;
	return storage;
};

//#endregion
export { _cache, getStorage };