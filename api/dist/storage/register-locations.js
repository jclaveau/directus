import { getConfigFromEnv } from "../utils/get-config-from-env.js";
import { RESUMABLE_UPLOADS } from "../constants.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";

//#region src/storage/register-locations.ts
const registerLocations = async (storage) => {
	const locations = toArray(useEnv()["STORAGE_LOCATIONS"]);
	const tus = {
		enabled: RESUMABLE_UPLOADS.ENABLED,
		chunkSize: RESUMABLE_UPLOADS.CHUNK_SIZE
	};
	locations.forEach((location) => {
		location = location.trim();
		const { driver,...options } = getConfigFromEnv(`STORAGE_${location.toUpperCase()}_`);
		storage.registerLocation(location, {
			driver,
			options: {
				...options,
				tus
			}
		});
	});
};

//#endregion
export { registerLocations };