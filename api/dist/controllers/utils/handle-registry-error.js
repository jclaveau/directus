import { ServiceUnavailableError } from "@directus/errors";

//#region src/controllers/utils/handle-registry-error.ts
function handleRegistryError(error) {
	if (error instanceof Error) {
		if (error.name === "TimeoutError") throw new ServiceUnavailableError({
			service: "marketplace",
			reason: "The registry server is not responding"
		});
		if (error.name === "TypeError" && error.message.includes("fetch")) throw new ServiceUnavailableError({
			service: "marketplace",
			reason: "Unable to connect to the registry server"
		});
		throw new ServiceUnavailableError({
			service: "marketplace",
			reason: error.message
		});
	}
	throw new ServiceUnavailableError({
		service: "marketplace",
		reason: "An unknown error occurred"
	});
}

//#endregion
export { handleRegistryError };