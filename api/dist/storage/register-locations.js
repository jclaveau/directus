import { RESUMABLE_UPLOADS } from "../constants.js";
import { getConfigFromEnv } from "../utils/get-config-from-env.js";
import { useEnv } from "@directus/env";

//#region src/storage/register-locations.ts
const registerLocations = async (storage) => {
	const locations = useEnv()["STORAGE_LOCATIONS"];
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