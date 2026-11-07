import { InvalidQueryError } from "@directus/errors";
import { MutationBatchingModes } from "@directus/types";
import { oneLine } from "@directus/utils";

//#region src/utils/mutation-batching-from-query.ts
/**
* The `mutationBatching` query param, left unset when absent; read off the
* raw query, since `sanitizeQuery` keeps only the read params.
*/
function mutationBatchingFromQuery(query) {
	const mutationBatching = query["mutationBatching"];
	if (mutationBatching !== void 0 && !MutationBatchingModes.includes(mutationBatching)) throw new InvalidQueryError({ reason: oneLine`
				"mutationBatching" must be one of ${MutationBatchingModes.join(", ")}
			` });
	return mutationBatching;
}

//#endregion
export { mutationBatchingFromQuery };